import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
// Explicit download once during setup; runtime OCR uses local language data only.
if (existsSync('.env')) process.loadEnvFile('.env');
const directory = process.env.OCR_LANG_PATH || './.cache/tessdata';
await mkdir(directory, { recursive: true });
const response = await fetch(
  'https://tessdata.projectnaptha.com/4.0.0/deu.traineddata.gz',
);
if (!response.ok) throw new Error(`Language download HTTP ${response.status}`);
await writeFile(
  `${directory}/deu.traineddata.gz`,
  Buffer.from(await response.arrayBuffer()),
);
console.log(`German OCR language installed in ${directory}`);
