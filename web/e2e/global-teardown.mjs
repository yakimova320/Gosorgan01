// Выполняется и при упавших тестах: схема браузерного прогона удаляется.
import { dropSchemas } from './db.mjs';

export default async function globalTeardown() {
  const schema = process.env.JASNO_E2E_SCHEMA;
  if (schema) await dropSchemas({ schema });
}
