import { matrix } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for POST /api/matrix. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => matrix(request, env);
