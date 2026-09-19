import { starter } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/starter. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => starter(request, env);
