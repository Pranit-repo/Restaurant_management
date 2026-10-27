const fs = require('fs');
const path = require('path');

const distMain = path.join(__dirname, 'dist', 'main.js');
const distSrcMain = path.join(__dirname, 'dist', 'src', 'main.js');

if (fs.existsSync(distSrcMain)) {
  fs.writeFileSync(distMain, 'require("./src/main.js");\n', 'utf8');
  console.log('Created dist/main.js bridge to dist/src/main.js');
}
