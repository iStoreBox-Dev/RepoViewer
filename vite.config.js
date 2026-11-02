import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { app: resolve(process.cwd(), 'app.html'), ipa: resolve(process.cwd(), 'ipa.html'), utilities: resolve(process.cwd(), 'utilities.html') } }
  }
});
