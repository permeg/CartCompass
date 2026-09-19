import { catalogSearch, health } from './handlers';
import type { Env } from './http';

/** The one place API paths are defined, shared by the dev server. The Cloudflare functions in `functions/` mirror it. */
export const routes: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/catalog/search': catalogSearch,
  '/api/health': health,
};
