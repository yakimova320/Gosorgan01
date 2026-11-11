import tseslint from 'typescript-eslint';
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/llm/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'openai',
                'openai/*',
                '@anthropic-ai/*',
                '@google/generative-ai',
                '@google/genai',
                'ai',
                '@ai-sdk/*',
              ],
              message:
                'All provider access belongs in llm/ through LlmService.',
            },
          ],
        },
      ],
    },
  },
];
