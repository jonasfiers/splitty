// Lint for the web app (2026-11-20): ESLint's recommended rules, plus React's
// rules of hooks (calls in the same order every render; effects that list
// what they read). `npm run lint -w web`; deploy.sh refuses errors.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'public/**', 'dev-dist/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, __APP_BUILD__: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Splitty strips control characters from text on purpose (codes, routes).
      'no-control-regex': 'off',
    },
  },
  { files: ['src/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  { files: ['vite.config.js', 'smoke/**', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
]
