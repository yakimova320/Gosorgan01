import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * `prisma migrate deploy` для отдельной схемы (тесты, песочница оценки).
 * Prisma CLI запускается напрямую через node, а не через `pnpm exec`: на Windows Node не находит
 * `pnpm` без оболочки (spawnSync pnpm ENOENT), а путь к node известен везде.
 */
export function migrateDeploy(apiDir: string, databaseUrl: string): void {
  execFileSync(
    process.execPath,
    [resolve(apiDir, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );
}
