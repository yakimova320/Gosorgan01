// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// SDK языковых моделей можно импортировать только внутри api/src/llm (ТЗ v2, правило 2).
const LLM_SDKS = [
  'openai',
  '@google/genai',
  '@google/generative-ai',
  '@anthropic-ai/sdk',
  'ai',
  '@ai-sdk/*',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'api/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Общий пакет работает и в браузере: только zod и свои файлы, без Node API (TechBriefing v5, 5.1).
    files: ['packages/shared/src/**/*.ts'],
    ignores: ['packages/shared/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!zod$|\\./).*',
              message:
                'В packages/shared можно импортировать только zod и свои файлы.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Buffer', message: 'Нет в браузере. Используйте utf8Bytes.' },
        { name: 'process', message: 'Нет в браузере.' },
        { name: 'require', message: 'Только ESM-импорты.' },
      ],
    },
  },
  {
    files: ['api/**/*.ts'],
    ignores: ['api/src/llm/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: LLM_SDKS,
              message: 'Модель вызывается только через api/src/llm/LlmService.',
            },
          ],
        },
      ],
    },
  },
);
