import { health } from '../../server/handlers';
import type { Env } from '../../server/http';

/** Cloudflare Pages Function for GET /api/health. `env` holds the project's variables and secrets. */
export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => health(request, env);
