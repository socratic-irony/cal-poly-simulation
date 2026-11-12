import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: lets the page POST canvas captures so every screenshot lands in ./screenshots
function screenshotSaver() {
  const dir = path.resolve('screenshots');
  return {
    name: 'screenshot-saver',
    configureServer(server) {
      fs.mkdirSync(dir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
        const url = new URL(req.url, 'http://x');
        const label = (url.searchParams.get('name') || 'shot').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const existing = fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.(png|jpg)$/.test(f));
          const next = existing.length ? Math.max(...existing.map((f) => parseInt(f.slice(0, 3), 10))) + 1 : 1;
          const file = `${String(next).padStart(3, '0')}-${label}.jpg`;
          fs.writeFileSync(path.join(dir, file), Buffer.concat(chunks));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ file: path.join(dir, file) }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [screenshotSaver()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
