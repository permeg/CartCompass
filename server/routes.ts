import { catalogSearch, health } from './handlers';

/** The one place API paths are defined, shared by the dev server and the Vercel wrappers. */
export const routes: Record<string, (request: Request) => Promise<Response>> = {
  '/api/catalog/search': catalogSearch,
  '/api/health': health,
};
