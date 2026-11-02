import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { ipa: resolve(process.cwd(), 'ipa.html') } }
  }
});
