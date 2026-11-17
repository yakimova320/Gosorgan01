import { parseDatabaseUrl } from './database-url.js';

describe('parseDatabaseUrl', () => {
  it('адрес без schema не меняется', () => {
    expect(
      parseDatabaseUrl('postgresql://jasno:jasno@localhost:5432/jasno'),
    ).toEqual({
      connectionString: 'postgresql://jasno:jasno@localhost:5432/jasno',
      schema: undefined,
    });
  });

  it('schema убирается из адреса и возвращается отдельно', () => {
    expect(
      parseDatabaseUrl(
        'postgresql://jasno:jasno@localhost:5432/jasno?schema=test_1&sslmode=disable',
      ),
    ).toEqual({
      connectionString:
        'postgresql://jasno:jasno@localhost:5432/jasno?sslmode=disable',
      schema: 'test_1',
    });
  });
});
