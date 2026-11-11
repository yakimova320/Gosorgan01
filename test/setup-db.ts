import { execFileSync } from 'node:child_process';
import { rmSync, openSync, closeSync } from 'node:fs';
export default function setup() {
  const path = `/tmp/razberemsya-test-${process.pid}.db`;
  closeSync(openSync(path, 'a'));
  process.env.DATABASE_URL = `file:${path}`;
  process.env.LLM_MODE = 'demo';
  process.env.NODE_ENV = 'test';
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'],
    { env: process.env, stdio: 'pipe' },
  );
  return () => {
    for (const suffix of ['', '-journal', '-wal', '-shm'])
      rmSync(path + suffix, { force: true });
  };
}
