import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@spotify/basic-pitch', '@tensorflow/tfjs'],
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.js'],
  },
});
