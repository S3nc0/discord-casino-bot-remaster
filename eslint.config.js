import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const IO_MODULES = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'os',
  'child_process',
  'crypto',
  'worker_threads',
  'net',
  'http',
  'https',
  'better-sqlite3',
  'discord.js',
  '@discordjs/*',
  'fastify',
  '@fastify/*',
  'socket.io',
  'socket.io-client',
  'croner',
];

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    'legacy/**',
    'design/**',
    'catalogs/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  // packages/shared is loaded by the browser too: no Node-only or server-only modules.
  {
    files: ['packages/shared/src/**/*.ts', 'packages/shared/i18n/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: IO_MODULES,
              message: 'packages/shared must run in the browser and on the server.',
            },
          ],
        },
      ],
    },
  },
  // packages/domain is pure: state + inputs (+ injected rng/clock) in, state + events out.
  {
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...IO_MODULES,
                'react',
                'react-dom',
                '@casino/ui',
                '@casino/server',
                '@casino/web',
              ],
              message: 'packages/domain is pure: no I/O.',
            },
            {
              regex: '(^|/)(apps|packages)/',
              message: 'Do not reach into other workspaces by path; import @casino/shared.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use ctx.clock.now().' },
        { object: 'Math', property: 'random', message: 'Use ctx.rng.' },
        { object: 'performance', property: 'now', message: 'Use ctx.clock.now().' },
        { object: 'crypto', message: 'Use ctx.rng.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'No environment access in domain code.' },
        { name: 'setTimeout', message: 'Scheduling belongs to the server.' },
        { name: 'setInterval', message: 'Scheduling belongs to the server.' },
        { name: 'fetch', message: 'No I/O in domain code.' },
        { name: 'require', message: 'No I/O in domain code.' },
        { name: 'globalThis', message: 'No ambient globals in domain code.' },
        { name: 'setImmediate', message: 'Scheduling belongs to the server.' },
        { name: 'queueMicrotask', message: 'Scheduling belongs to the server.' },
        { name: 'WebSocket', message: 'No I/O in domain code.' },
        { name: 'XMLHttpRequest', message: 'No I/O in domain code.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use new Date(ctx.clock.now()).',
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: 'Date() reads the wall clock. Use ctx.clock.now().',
        },
        { selector: 'ImportExpression', message: 'No dynamic imports in domain code.' },
      ],
    },
  },
]);
