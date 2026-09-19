import { prices } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/prices. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => prices(request, env);
