import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'engine/client/Client.ts'),
      name: 'ModuEngine',
      fileName: 'modu',
    },
    outDir: 'dist/client',
  },
  resolve: {
    alias: {
      'modu-engine': resolve(__dirname, 'engine/core/index.ts'),
    },
  },
});
