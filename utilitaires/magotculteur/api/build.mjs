// Construit l'API en un seul fichier Node : api/dist/server.mjs (moteur, liens et
// lz-string inclus). La version affichée est celle de l'interface (public/versions.js).
//
//   npm run build:api
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const versions = readFileSync(`${dir}public/versions.js`, 'utf8');
const version = versions.match(/CURRENT_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!version) throw new Error('CURRENT_VERSION introuvable dans public/versions.js');

await build({
  entryPoints: [`${dir}api/server.mjs`],
  outfile: `${dir}api/dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  define: { __MAGOTCULTEUR_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
});
console.log(`api/dist/server.mjs construit (${version})`);
