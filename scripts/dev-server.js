'use strict';

// Local server for the player. It serves web/ and runs api/collection.js, which `python3 -m http.server` can't do.
//   node scripts/dev-server.js                   http://127.0.0.1:8790/
//   HOST=0.0.0.0 node scripts/dev-server.js      reachable from other devices on your network, such as a phone
const http = require('http');
const fs = require('fs');
const path = require('path');
const collection = require('../api/collection.js');

const root = path.join(__dirname, '..', 'web');
const port = Number(process.env.PORT) || 8790;
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.m4a': 'audio/mp4' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/collection') {
    // The same shape Vercel gives a function.
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    return collection(req, res);
  }
  let file;
  try { file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { file = ''; }
  if (!file.startsWith(root + path.sep)) { res.statusCode = 404; return res.end('Not found'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
}).listen(port, host, () => console.log(`Subtok player at http://${host}:${port}/`));
