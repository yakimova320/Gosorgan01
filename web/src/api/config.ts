/*
 * Настройки сайта из web/.env (переменные VITE_*). Ключей модели здесь нет.
 */

export type DataMode = 'mock' | 'api';

const env = import.meta.env;

export const API_URL: string = (env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:3000';

/** mock: примерные данные без сервера; api: данные с сервера. */
export const DATA_MODE: DataMode = env.VITE_DATA_MODE === 'api' ? 'api' : 'mock';

export const IS_PRODUCTION: boolean = env.PROD === true;

export const REQUEST_TIMEOUT_MS = 90_000;
