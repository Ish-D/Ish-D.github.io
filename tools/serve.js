/**
 * Static file server for working on the site and for checking a build.
 *
 *   node tools/serve.js [port] [--root DIR] [--pages]
 *
 * By default every address that is not a file gets the app, as the dev server does. With `--pages` it answers as GitHub
 * Pages does: a folder has its index.html (and a missing slash is added), and anything else is a 404 that serves 404.html.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

const typeOf = (file) => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * The request handler of the server, apart from the server so it can be used without a port.
 * @param {{ root: string, pages?: boolean }} options
 * @returns {(req: { url: string }, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function staticHandler({ root, pages = false }) {
    const base = resolve(root);
    return async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
        const file = join(base, path);
        if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
        const send = async (target, status = 200) => {
            const body = await readFile(target);
            res.writeHead(status, { 'content-type': typeOf(target), 'cache-control': 'no-cache' });
            res.end(body);
        };
        try {
            const info = await stat(file);
            if (!info.isDirectory()) { await send(file); return; }
            if (pages && !url.pathname.endsWith('/')) {
                res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
                return;
            }
            await send(join(file, 'index.html'));
        } catch {
            try {
                if (pages) { await send(join(base, '404.html'), 404); return; }
                if (!extname(path)) { await send(join(base, 'index.html')); return; }
            } catch {
                // nothing to send in its place
            }
            res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        }
    };
}

export const createStaticServer = (options) => createServer(staticHandler(options));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
    const pages = args.includes('--pages');
    const rootArg = flag('--root');
    const port = Number(args.filter(a => /^\d+$/.test(a))[0] ?? 8123);
    const root = resolve(rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
    createStaticServer({ root, pages }).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}${pages ? ' as GitHub Pages does' : ''}`));
}
