import { gas } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/gas. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => gas(request, env);
