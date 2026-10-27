const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Run prisma migrate deploy if DATABASE_URL is set
if (process.env.DATABASE_URL) {
  console.log('Running database migrations (prisma migrate deploy)...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('Database migrations completed successfully.');
  } catch (err) {
    console.error('Database migration failed:', err.message);
    process.exit(1);
  }

  // Seed default permissions and initial data if seed script exists
  const seedPath = path.join(__dirname, 'dist', 'prisma', 'seed.js');
  if (fs.existsSync(seedPath)) {
    console.log('Seeding initial permissions and data...');
    try {
      execSync(`node "${seedPath}"`, { stdio: 'inherit' });
      console.log('Database seed completed successfully.');
    } catch (err) {
      console.warn('Database seed warning (continuing startup):', err.message);
    }
  }
} else {
  console.warn('DATABASE_URL is not set. Skipping migrations and seed.');
}

// Start NestJS application
console.log('Starting Nodedr OrderRestro backend server...');
require('./dist/src/main.js');
