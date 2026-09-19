import { geocode } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/geocode. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => geocode(request, env);
