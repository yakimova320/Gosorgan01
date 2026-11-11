import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('prisma/schema.prisma', 'utf8');
writeFileSync(
  'prisma/schema.postgres.prisma',
  source.replace('provider = "sqlite"', 'provider = "postgresql"'),
);
console.log(
  'Generated prisma/schema.postgres.prisma. Set DATABASE_URL, then pnpm exec prisma db push --schema prisma/schema.postgres.prisma',
);
