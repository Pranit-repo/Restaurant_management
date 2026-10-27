import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppModule } from './app.module';
import { uploadsDir } from './common/upload/image-upload.config';

// Known example/placeholder secrets that appear verbatim in this repo's own
// .env.example, docker-compose.yml, and the CasaOS/ZimaOS app-store
// manifest (casaos/docker-compose.yml) — that manifest hardcodes a literal
// default value (CasaOS app-store installers pre-fill it and many
// non-technical self-hosters click through without changing it) rather
// than failing loudly the way `${JWT_SECRET:?...}` does in the main
// docker-compose.yml. This is a defense-in-depth backstop that applies to
// every deployment path, not just CasaOS: refuse to issue/verify sessions
// signed with a known-public or too-short secret instead of silently
// running with one an attacker can read directly from the public repo.
const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  'please-change-this-to-a-long-random-string',
  'change-me-to-a-long-random-string',
  'change-me',
  'changeme',
  'secret',
  'your-secret-here',
]);
const MIN_JWT_SECRET_LENGTH = 32;

function isUsableSecret(secret: string): boolean {
  return (
    secret.length >= MIN_JWT_SECRET_LENGTH &&
    !KNOWN_PLACEHOLDER_JWT_SECRETS.has(secret.toLowerCase())
  );
}

// Resolves the JWT signing secret and returns it — also sets
// process.env.JWT_SECRET so every other module that reads it directly
// (auth.module.ts, jwt.strategy.ts, realtime.module.ts) sees the same
// value, since this runs before NestFactory.create() instantiates them.
//
// An explicit, valid JWT_SECRET env var always wins. Otherwise, attempts
// to persist a generated secret across /data/state, local cwd, or temp dir,
// falling back to in-memory if disk is unwritable.
function resolveJwtSecret(): string {
  const envSecret = (process.env.JWT_SECRET ?? '').trim();
  if (isUsableSecret(envSecret)) {
    return envSecret;
  }

  const candidates: string[] = [];
  if (process.env.JWT_SECRET_STATE_FILE) {
    candidates.push(process.env.JWT_SECRET_STATE_FILE);
  }
  candidates.push('/data/state/jwt-secret');
  candidates.push(join(process.cwd(), 'data', 'state', 'jwt-secret'));
  candidates.push(join(tmpdir(), 'nodedr-jwt-secret'));

  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        const persisted = readFileSync(filePath, 'utf8').trim();
        if (isUsableSecret(persisted)) {
          return persisted;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  const generated = randomBytes(32).toString('hex');

  for (const filePath of candidates) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, generated, { mode: 0o600 });
      console.warn(
        `JWT_SECRET was not set (or was a known placeholder) — generated a random one and saved it to ${filePath}. ` +
          'It will be reused on every restart, so existing sessions stay valid. Set JWT_SECRET explicitly in your environment variables for production.',
      );
      return generated;
    } catch {
      // Try next candidate if permission denied or path unwritable
    }
  }

  console.warn(
    'JWT_SECRET was not set and could not be persisted to disk (read-only or restricted filesystem). ' +
      'Using an in-memory random secret for this session. Set JWT_SECRET explicitly in your environment variables for production.',
  );
  return generated;
}

async function bootstrap() {
  process.env.JWT_SECRET = resolveJwtSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(
    helmet({
      // Uploaded images are fetched cross-origin-ish (via the frontend's
      // same-origin /api proxy, but still through an <img> tag) — the
      // default helmet CORP header blocks that in some browsers.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:1995',
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useStaticAssets(uploadsDir(), { prefix: '/api/uploads/' });

  // Full route/schema map — genuinely useful in dev, but an unauthenticated
  // information-disclosure surface (every endpoint shape, DTO field, and
  // permission key) if left reachable in production. Opt in explicitly via
  // ENABLE_SWAGGER=true if a deployment wants it anyway (e.g. behind its
  // own reverse-proxy auth).
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true'
  ) {
    const config = new DocumentBuilder()
      .setTitle('Nodedr OrderRestro API')
      .setDescription('REST API for the Nodedr OrderRestro management system')
      .setVersion('1.0')
      .addCookieAuth('nodedr_session')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(
    `Nodedr OrderRestro API listening on :${port} (docs at /api/docs)`,
  );
}
void bootstrap();
