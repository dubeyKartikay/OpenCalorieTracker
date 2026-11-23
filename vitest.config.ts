/// <reference types="node" />

// Match the Expo app's CommonJS configuration so Node can load this natively.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo uses CommonJS config files.
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
