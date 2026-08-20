import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// O build roda dentro do node:20-alpine, que não tem git instalado — por isso
// o `git rev-parse` sozinho sempre caía no fallback e a versão publicada saía
// como "dev". O Coolify passa o commit em SOURCE_COMMIT, então ele vem primeiro.
function descobrirCommit() {
  const doCoolify = (process.env.SOURCE_COMMIT || '').trim();
  if (doCoolify) return doCoolify.slice(0, 7);

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return '';
  }
}

const commit = descobrirCommit();
const agora = Date.now();

mkdirSync(publicDir, { recursive: true });
writeFileSync(
  join(publicDir, 'version.json'),
  JSON.stringify({
    // Mantido no formato antigo: o useAppUpdate compara a string inteira para
    // detectar que saiu build novo, e o timestamp já garante que ela muda.
    version: `${agora}-${commit || 'dev'}`,
    commit,
    data: new Date(agora).toISOString(),
  })
);
