import { places } from '../../server/handlers';

/** Cloudflare Pages Function for GET /api/places. */
export const onRequest = ({ request }: { request: Request }): Promise<Response> => places(request);
