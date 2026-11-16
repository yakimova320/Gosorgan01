import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // FAQ и карточки лежат в ../content: разрешаем читать папку выше web/
    fs: { allow: ['..'] },
  },
});
