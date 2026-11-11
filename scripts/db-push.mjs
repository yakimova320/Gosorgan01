import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.DATABASE_URL ||= 'file:./dev.db';
if (process.env.DATABASE_URL.startsWith('file:')) {
  const path = resolve(
    'prisma',
    process.env.DATABASE_URL.slice(5).split('?')[0],
  );
  mkdirSync(dirname(path), { recursive: true });
  closeSync(openSync(path, 'a'));
}
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'db',
    'push',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env },
);
process.exitCode = result.status ?? 1;
