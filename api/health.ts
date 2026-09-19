import { health } from '../server/handlers';

export const GET = (): Promise<Response> => health();
