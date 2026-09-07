import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dev-dist is the service worker vite-plugin-pwa generates in dev; like dist it is
  // build output, not source.
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // server/ is CommonJS with its own package.json, so it gets Node globals
    // instead of the browser ones the frontend block applies. Flat config merges
    // `globals` rather than replacing them, so the browser set is switched off
    // explicitly first — otherwise a stray `document` in server code lints clean.
    files: ['server/**/*.js'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.browser).map((name) => [name, 'off'])),
        ...globals.node,
      },
      sourceType: 'commonjs',
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
  },
])
