import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: {
      'modu-engine': resolve(__dirname, 'engine/core/index.ts'),
    },
  },
});
