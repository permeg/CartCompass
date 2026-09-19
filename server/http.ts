/** Server settings and secrets. Comes from process.env in dev and from the platform's bindings in production. */
export type Env = Record<string, string | undefined>;

export function json(body: unknown, init: { status?: number; cache?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': init.cache ?? 'no-store',
    },
  });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, { status });
}

/** Best-effort client address for rate limiting. Never used for anything else. */
export function clientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (
    request.headers.get('cf-connecting-ip') ||
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}
