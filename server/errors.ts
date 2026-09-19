/** A failure from a service we call. Carries the HTTP status so handlers can tell "rate limited" from "broken". */
export class UpstreamError extends Error {
  constructor(
    public readonly service: string,
    public readonly status: number,
  ) {
    // Deliberately no response body: upstream errors can echo credentials or request details.
    super(`${service} responded ${status}`);
    this.name = 'UpstreamError';
  }
}

/** True when the service said we've used up our quota. */
export function isRateLimited(err: unknown): boolean {
  return err instanceof UpstreamError && err.status === 429;
}
