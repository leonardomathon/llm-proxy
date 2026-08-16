import { Hono } from "hono";

import { proxyAuth } from "./middleware/proxy-auth";
import { getModels, ModelsFetchError } from "./models/fetch-models";
import { renderErrorPage, renderModelsPage } from "./models/models-page";
import { forward } from "./proxy/forward";

export const app = new Hono<{ Bindings: Env }>();

// Local health endpoint. Never contacts OpenRouter and never requires auth.
app.get("/healthz", (c) => c.json({ status: "ok" }));

// Server-rendered model browser. Authenticated, server-side fetch, key never
// reaches the browser; the underlying model data is cached for 15 minutes.
app.get("/models", proxyAuth(), async (c) => {
  try {
    const models = await getModels(c.env);
    return c.html(renderModelsPage(models));
  } catch (err) {
    console.error(
      JSON.stringify({
        error: err instanceof Error ? err.name : "error",
        status: err instanceof ModelsFetchError ? err.status : undefined,
        path: "/models",
      }),
    );
    return c.html(renderErrorPage(502, "Could not load models from OpenRouter."), 502);
  }
});

// Proxied surface: fixed `/api/v1/*`, authenticated, restricted methods.
app.all("/api/v1/*", proxyAuth(), async (c) => {
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "HEAD") {
    return c.json({ error: "Method Not Allowed" }, 405, { Allow: "GET, POST, HEAD" });
  }

  const started = Date.now();
  const requestId = crypto.randomUUID();
  const path = new URL(c.req.url).pathname;
  const response = await forward(c, c.req.raw);
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path,
      status: response.status,
      durationMs: Date.now() - started,
    }),
  );
  return response;
});

// Everything else (e.g. `/foo`, `/api/v2/...`, `/healthz/extra`) is 404.
app.all("*", (c) => c.json({ error: "Not Found" }, 404));

// Coarse error handling: never leak secret/payload details to the client.
app.onError((err, c) => {
  console.error(
    JSON.stringify({
      error: err instanceof Error ? err.name : "error",
      path: new URL(c.req.url).pathname,
    }),
  );
  return c.json({ error: "Bad Gateway" }, 502);
});
