import { EMBEDDING_DIM } from './llm.types.js';

/**
 * L05: вектор к длине EMBEDDING_DIM и длине 1 (косинусное расстояние в pgvector).
 * Длиннее — обрезается: модели Gemini обучены так, что первые числа вектора самые важные.
 * Короче или без чисел — null: такой ответ модели не принимается.
 */
export function fitVector(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < EMBEDDING_DIM) return null;
  const v = raw.slice(0, EMBEDDING_DIM);
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return normalize(v as number[]);
}

/** Длина 1. Нулевой вектор получает 1 в первом числе: у нуля нет направления, pgvector дал бы NaN. */
export function normalize(v: number[]): number[] {
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (len === 0) return v.map((_, i) => (i === 0 ? 1 : 0));
  return v.map((x) => x / len);
}

/** Запись для pgvector: '[0.1,0.2,…]'. */
export function toPgVector(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
}
