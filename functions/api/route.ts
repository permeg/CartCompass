import { route } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for POST /api/route. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => route(request, env);
