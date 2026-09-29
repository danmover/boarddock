import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the same build works on GitHub Pages (sub-path) and inside the Electron app.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // (.claude/: other git worktrees of this repo, which have tests of their own)
  test: { environment: 'node', testTimeout: 120000, exclude: [...configDefaults.exclude, '.claude/**'] },
});
