/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    eqeqeq: ['error', 'always'],
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='ScanCommand']",
        message:
          'DynamoDB Scan is banned in request paths (CLAUDE.md §2). Use a documented access pattern with Query/GetItem.',
      },
    ],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      files: ['infrastructure/**/*.ts'],
      rules: {
        'no-new': 'off',
      },
    },
    {
      files: ['apps/frontend/**/*.{ts,tsx}'],
      env: { browser: true },
      parserOptions: { ecmaFeatures: { jsx: true } },
      rules: {
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    'cdk.out',
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs',
    '!.eslintrc.cjs',
    'apps/frontend/vite.config.ts',
  ],
};
