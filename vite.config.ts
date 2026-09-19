import { Readable } from 'node:stream';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Serves the handlers in `server/` at `/api/*` during `npm run dev`, so the app
 * talks to the same code that runs as Vercel functions in production. Edits to
 * `server/` reload without restarting.
 */
function apiPlugin(): Plugin {
  return {
    name: 'cart-compass-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
          const { routes } = (await server.ssrLoadModule('/server/routes.ts')) as typeof import('./server/routes');
          const handler = routes[url.pathname];
          if (!handler) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'not_found' }));
            return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          const response = await handler(new Request(url, { method: req.method, headers }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (response.body) Readable.fromWeb(response.body as never).pipe(res);
          else res.end();
        } catch (err) {
          server.config.logger.error(String(err));
          res.statusCode = 500;
          res.end('Internal error');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-side keys (KROGER_*) live in .env.local and never reach the browser,
  // because only VITE_-prefixed variables are exposed to client code.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), apiPlugin()],
    server: { port: Number(process.env.PORT) || 5173 },
    test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
  };
});
