const globals = require('globals')
const typescript = require('@typescript-eslint/eslint-plugin')
const reactHooks = require('eslint-plugin-react-hooks')
const prettier = require('eslint-plugin-prettier/recommended')

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**'],
  },
  ...typescript.configs['flat/recommended'],
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: false }],
    },
  },
]
