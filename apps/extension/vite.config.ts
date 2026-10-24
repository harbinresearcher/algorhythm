import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'chrome116',
    rollupOptions: {
      input: {
        workspace: resolve(import.meta.dirname, 'workspace.html'),
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
  test: { environment: 'node', setupFiles: ['tests/setup.ts'] },
});
