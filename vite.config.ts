import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Emits dist/sw.js from web/sw.js with this build's version and the files that make up the
 * guest-site shell (the entry script and stylesheet). Staff screens are cached as they are opened,
 * so a guest on mobile data never downloads the back office.
 */
function serviceWorker(): Plugin {
  return {
    name: 'danest-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const shell = ['/', ...files.filter((f) => /^assets\/index-[\w-]+\.(js|css)$/.test(f)).map((f) => `/${f}`), '/brand/crest-128.png', '/brand/icon-192.png'];
      const source = readFileSync(fileURLToPath(new URL('./web/sw.js', import.meta.url)), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('[/* __SHELL__ */]', JSON.stringify(shell));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  root: 'web',
  publicDir: '../public',
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
