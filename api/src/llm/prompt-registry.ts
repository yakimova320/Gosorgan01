import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Папка промптов. От api/, чтобы путь был одинаковым из src и из dist. */
export const PROMPTS_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'llm',
  'prompts',
);

export interface Prompt {
  name: string;
  version: number;
  system: string;
  user: string;
}

/**
 * Промпты лежат в api/src/llm/prompts/<имя>.v<N>.md. Старые версии не меняются, новая версия = новый файл.
 * Файл: раздел «# System» (инструкции) и раздел «# User» (шаблон с {{переменными}}).
 */
@Injectable()
export class PromptRegistry {
  private readonly cache = new Map<string, Prompt>();

  constructor(private readonly dir: string = PROMPTS_DIR) {}

  /** Без version берётся последняя версия. */
  get(name: string, version?: number): Prompt {
    const v = version ?? this.latestVersion(name);
    const key = `${name}.v${v}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const file = resolve(this.dir, `${key}.md`);
    if (!existsSync(file)) throw new Error(`Промпт не найден: ${key}.md`);
    const prompt = parsePrompt(name, v, readFileSync(file, 'utf8'));
    this.cache.set(key, prompt);
    return prompt;
  }

  latestVersion(name: string): number {
    const versions = readdirSync(this.dir)
      .map((f) => new RegExp(`^${name}\\.v(\\d+)\\.md$`).exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
    if (versions.length === 0) throw new Error(`Промпт не найден: ${name}`);
    return Math.max(...versions);
  }
}

export function parsePrompt(
  name: string,
  version: number,
  text: string,
): Prompt {
  const match = /^# System\s*\n([\s\S]*?)\n# User\s*\n([\s\S]*)$/m.exec(text);
  if (!match)
    throw new Error(
      `Промпт ${name}.v${version}: нужны разделы «# System» и «# User»`,
    );
  return { name, version, system: match[1].trim(), user: match[2].trim() };
}

/** Подставляет {{имя}}. Неизвестная переменная в шаблоне — ошибка, чтобы не отправить пустое место. */
export function render(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_all, key: string) => {
    if (!(key in variables)) throw new Error(`Нет переменной {{${key}}}`);
    return variables[key];
  });
}
