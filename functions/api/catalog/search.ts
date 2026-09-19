import { catalogSearch } from '../../../server/handlers';
import type { Env } from '../../../server/http';

/** Cloudflare Pages Function for GET /api/catalog/search. Non-GET requests get a 405 from the handler. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> =>
  catalogSearch(request, env);
