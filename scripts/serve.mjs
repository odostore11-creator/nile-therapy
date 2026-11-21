// Local preview of the static site, served under /nile-therapy/ just like GitHub Pages.
// Run:  node scripts/serve.mjs   then open http://localhost:5500/nile-therapy/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BASE = '/nile-therapy/';
const PORT = Number(process.env.PORT || 5500);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(BASE)) { res.writeHead(302, { Location: BASE }); return res.end(); }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}${BASE}`));
