import { parseEnv } from './env.schema.js';

describe('parseEnv', () => {
  it('даёт значения по умолчанию для пустого окружения', () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.LLM_MODE).toBe('demo');
    expect(env.MAIL_MODE).toBe('file');
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:5173']);
    expect(env.UPLOAD_MAX_LETTER_MB).toBe(20);
  });

  it('пустые строки считает отсутствующими', () => {
    expect(parseEnv({ PORT: '', LLM_API_KEY: '' }).PORT).toBe(3000);
  });

  it('разбирает несколько адресов CORS через запятую', () => {
    const env = parseEnv({ CORS_ORIGIN: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });

  it('для LLM_MODE=openai требует адрес, ключ и модель', () => {
    expect(() => parseEnv({ LLM_MODE: 'openai' })).toThrow(/LLM_API_KEY/);
  });

  it('запрещает MAIL_MODE=file в production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/MAIL_MODE/);
  });

  it('не показывает значение ключа в тексте ошибки', () => {
    try {
      parseEnv({ LLM_MODE: 'openai', LLM_API_KEY: 'secret-key-123', PORT: 'abc' });
    } catch (e) {
      expect(String(e)).not.toContain('secret-key-123');
      return;
    }
    throw new Error('ожидалась ошибка');
  });
});
