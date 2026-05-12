import { defineConfig } from 'vite';

export default defineConfig({
  base: '/codecraft/',
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
