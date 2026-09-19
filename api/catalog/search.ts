import { catalogSearch } from '../../server/handlers';

export const GET = (request: Request): Promise<Response> => catalogSearch(request);
