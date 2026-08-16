import type { MiddlewareHandler } from "hono";

import { proxyToken } from "../config";

/**
 * Authenticate `/api/v1/*` requests with `Authorization: Bearer <proxy token>`.
 *
 * Missing, non-Bearer, empty, or wrong tokens all yield 401 without contacting
 * the upstream. The error body never echoes the supplied token.
 */
export function proxyAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    // Fail closed: a missing secret binding throws (handled as 5xx), it never
    // silently disables authentication.
    const expected = proxyToken(c.env);

    const header = c.req.header("Authorization");
    // `Bearer` is case-insensitive per RFC 6750; the token is everything after.
    const match = /^Bearer[ \t]+(.+)$/i.exec(header ?? "");
    const supplied = match?.[1] ?? "";

    // ponytail: plain string compare; the token is high-entropy and network
    // jitter dwarfs any timing signal. Use timingSafeEqual if this ever sits
    // on a shared untrusted network where timing attacks are in scope.
    let response: Response | undefined;
    if (supplied.length > 0 && supplied === expected) {
      await next();
    } else {
      response = c.json({ error: "Unauthorized" }, 401);
    }
    return response;
  };
}
