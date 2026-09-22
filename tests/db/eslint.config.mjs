import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    // assertions on query results are the point of these tests
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
