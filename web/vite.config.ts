/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/*
 * mode offline (pnpm build:offline): один файл dist-offline/index.html со всем кодом внутри,
 * данные mock, адреса после «#». Открывается двойным щелчком без сервера (file://).
 */
export default defineConfig(({ mode }) => ({
  plugins: mode === 'offline' ? [react(), viteSingleFile()] : [react()],
  base: mode === 'offline' ? './' : '/',
  build: mode === 'offline' ? { outDir: 'dist-offline' } : undefined,
  server: {
    port: 5173,
    // FAQ и карточки лежат в ../content: разрешаем читать папку выше web/
    fs: { allow: ['..'] },
  },
  test: { include: ['src/**/*.test.ts'] },
}));
