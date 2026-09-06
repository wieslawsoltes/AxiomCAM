import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.nc': 'text/plain; charset=utf-8', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
    try {
        const raw = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), file = path.resolve(root, '.' + raw);
        if (file !== root && !file.startsWith(root + path.sep)) {
            res.writeHead(403).end('Forbidden');
            return;
        }
        let target = file;
        const info = await stat(target);
        if (info.isDirectory())
            target = path.join(target, 'index.html');
        const body = await readFile(target);
        res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' });
        res.end(body);
    }
    catch (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain' }).end(error.code === 'ENOENT' ? 'Not found' : 'Bad request');
    }
});
server.on('error', error => { console.error(`AxiomCAM server: ${error.message}. Choose another port with the PORT environment variable.`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`AxiomCAM running at http://localhost:${port}\nPress Ctrl+C to stop. No install or build step is required.`));
