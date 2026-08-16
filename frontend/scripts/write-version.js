import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // sem git disponível no build (ex: build fora de um repo) — usa fallback
}

mkdirSync(publicDir, { recursive: true });
writeFileSync(
  join(publicDir, 'version.json'),
  JSON.stringify({ version: `${Date.now()}-${commit}` })
);
