import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Перевірки на те, що вже ламалось.
 *
 * Кожен тест тут названий своєю бідою: не «unitOf works», а «„Мін“ — це
 * не вага штуки». Тест, який не нагадує, що саме пішло не так, за рік
 * прочитають як забаганку й викинуть.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
