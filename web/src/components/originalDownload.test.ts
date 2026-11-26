import { describe, expect, it } from 'vitest';
import { originalFileName, originalPdf } from './originalDownload';

describe('E02: скачивание оригинала', () => {
  it('имя файла: дата и название без опасных знаков', () => {
    expect(originalFileName('Jobcenter: документы / Antrag?', '2026-11-26T10:00:00.000Z')).toBe(
      'Jasno_2026-11-26_Jobcenter_документы_Antrag.pdf',
    );
    expect(originalFileName(null, '2026-11-26T10:00:00.000Z')).toBe('Jasno_2026-11-26_original.pdf');
    expect(originalFileName('a\u0007b', undefined)).toBe('Jasno_a_b.pdf');
  });

  it('один PDF возвращается теми же байтами', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    expect(await originalPdf([{ mime: 'application/pdf', bytes }])).toBe(bytes);
  });
});
