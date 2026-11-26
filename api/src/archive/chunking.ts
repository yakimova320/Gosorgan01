import { createHash } from 'node:crypto';

/** L05: примерная длина куска письма для поиска. Абзац длиннее режется по строкам. */
export const CHUNK_CHARS = 800;
/** Письмо длиннее этого в поиск идёт не целиком: экономия обращений к модели. */
export const MAX_CHUNKS_PER_LETTER = 12;

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Делит текст письма на куски до CHUNK_CHARS знаков по абзацам и строкам.
 * Каждый кусок — точный отрезок текста письма (строки целиком), поэтому цитата из куска
 * всегда находится в самом письме. Пустых кусков нет.
 */
export function splitLetter(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    const chunk = current.join('\n').trim();
    if (chunk) chunks.push(chunk);
    current = [];
    size = 0;
  };
  for (const line of lines) {
    // строка длиннее куска: отдельным куском по словам
    if (line.length > CHUNK_CHARS) {
      flush();
      let rest = line;
      while (rest.length > CHUNK_CHARS) {
        const cut = rest.lastIndexOf(' ', CHUNK_CHARS);
        const at = cut > CHUNK_CHARS / 2 ? cut : CHUNK_CHARS;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      current.push(rest);
      size = rest.length;
      continue;
    }
    if (size + line.length + 1 > CHUNK_CHARS) flush();
    // пустая строка после половины куска: граница абзаца — хорошее место для разреза
    if (!line.trim() && size > CHUNK_CHARS / 2) {
      flush();
      continue;
    }
    current.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks.filter(Boolean).slice(0, MAX_CHUNKS_PER_LETTER);
}
