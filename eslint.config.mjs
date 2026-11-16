// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// SDK языковых моделей можно импортировать только внутри api/src/llm (ТЗ v2, правило 2).
const LLM_SDKS = ['openai', '@google/genai', '@google/generative-ai', '@anthropic-ai/sdk', 'ai', '@ai-sdk/*'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
            { group: LLM_SDKS, message: 'Модель вызывается только через api/src/llm/LlmService.' },
          ],
        },
      ],
    },
  },
);
