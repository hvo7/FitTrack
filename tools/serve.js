/* Minimal static server for testing the built site locally — including on your
 * phone, which is the only way to check the PWA install flow for real.
 *
 *   npm run build:pages && npm run serve
 *
 * Then open the printed LAN address on your phone. Note that iOS and Android
 * both require HTTPS for service workers, with localhost as the one exception —
 * so installing to a phone home screen needs the deployed GitHub Pages URL.
 * This server is for checking layout and behaviour.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', 'dist-pages');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

if (!fs.existsSync(ROOT)) {
  console.error('dist-pages/ not found — run "npm run build:pages" first.');
  process.exit(1);
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';

  // Keep traversal inside dist-pages.
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(data);
  });
}).listen(PORT, () => {
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log(`FitTrack (live) http://localhost:${PORT}/`);
  console.log(`FitTrack (dev)  http://localhost:${PORT}/dev/`);
  addrs.forEach((a) => console.log(`on your network   http://${a}:${PORT}/`));
});
