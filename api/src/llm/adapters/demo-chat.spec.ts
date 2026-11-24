import { DEMO_CHAT_FALLBACK, demoChat } from './demo.adapter.js';

const FAQ = `# FAQ

## Регистрация

### Можно войти через Google или Apple?

Пока нет, только e-mail и пароль.

### Как удалить аккаунт?

В профиле кнопка «Удалить аккаунт».

## Письма

### Какие письма можно загрузить?

PDF или фото письма от ведомства.
`;

describe('demoChat (чат-помощник, 24.11)', () => {
  it('находит похожий вопрос FAQ и отвечает его текстом', () => {
    const { answer } = demoChat('а через Google войти можно?', FAQ);
    expect(answer).toBe('Похожий вопрос есть в FAQ: «Можно войти через Google или Apple?»\n\nПока нет, только e-mail и пароль.');
  });
  it('ответ не захватывает следующий раздел', () => {
    expect(demoChat('Как удалить аккаунт?', FAQ).answer).not.toContain('## Письма');
  });
  it('нет похожего вопроса или нет FAQ — честный ответ демо-режима', () => {
    expect(demoChat('Какая погода на Марсе?', FAQ).answer).toBe(DEMO_CHAT_FALLBACK);
    expect(demoChat('Как удалить аккаунт?', '').answer).toBe(DEMO_CHAT_FALLBACK);
  });
});
