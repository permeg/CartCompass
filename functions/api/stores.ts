import { stores } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/stores. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => stores(request, env);
