// Build előtti lépés: verziószám generálása a bundle-be.
// A "Több" oldal mutatja — így ellenőrizhető, hogy minden eszközön
// ugyanaz a kiadás fut. Formátum: ÉÉÉÉ.HH.NN-óópp + git hash.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
let hash = '';
try {
  hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // git nélkül is működjön
}
const version = hash ? `${stamp} (${hash})` : stamp;

const path = new URL('../src/lib/version.ts', import.meta.url).pathname;
writeFileSync(path, `// Generálva a scripts/genversion.mjs által — kézzel ne szerkeszd.
export const APP_VERSION = '${version}';
`);
console.log('Verzió:', version);
