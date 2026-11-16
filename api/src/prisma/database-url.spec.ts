import { resolveSqliteUrl } from './database-url.js';

describe('resolveSqliteUrl', () => {
  it('относительный путь SQLite считается от папки api', () => {
    expect(resolveSqliteUrl('file:./dev.db', '/app/api')).toBe(
      'file:/app/api/dev.db',
    );
  });

  it('абсолютный путь и :memory: не меняются', () => {
    expect(resolveSqliteUrl('file:/data/jasno.db', '/app/api')).toBe(
      'file:/data/jasno.db',
    );
    expect(resolveSqliteUrl('file::memory:', '/app/api')).toBe('file::memory:');
  });

  it('адрес PostgreSQL не меняется', () => {
    const url = 'postgresql://user:pass@localhost:5432/jasno';
    expect(resolveSqliteUrl(url, '/app/api')).toBe(url);
  });
});
