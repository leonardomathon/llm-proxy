import { openRouterApiKey } from "../config";
import type {
  BenchmarksResponse,
  ModelInfo,
  ModelScores,
  OpenRouterModel,
  OpenRouterModelsResponse,
} from "./types";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const BENCHMARKS_URL = "https://openrouter.ai/api/v1/benchmarks?source=artificial-analysis";
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

/** Raised when an OpenRouter request does not return 2xx. */
export class ModelsFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`OpenRouter returned ${status}`);
    this.name = "ModelsFetchError";
    this.status = status;
  }
}

/** Minimal cache surface so tests can inject an in-memory stub. */
export interface ModelCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

const EMPTY_SCORES: ModelScores = { intelligence: null, coding: null, agentic: null };

/** Extract the vendor prefix from a model id, e.g. `anthropic/claude-…` → `anthropic`. */
export function extractProvider(id: string): string {
  return id.split("/")[0] ?? "";
}

/** Convert a per-token dollar price (OpenRouter string) to dollars per 1M tokens. */
export function pricePerMillion(pricePerToken: string | undefined): number | null {
  if (pricePerToken === undefined || pricePerToken === "") return null;
  const value = Number(pricePerToken);
  if (!Number.isFinite(value)) return null;
  return value * 1_000_000;
}

function capabilitiesOf(model: OpenRouterModel): string[] {
  const caps: string[] = [];
  const modality = model.architecture?.modality;
  if (modality) caps.push(modality.replaceAll("->", " → "));
  const params = model.supported_parameters ?? [];
  if (params.includes("tools") || params.includes("responses")) caps.push("tools");
  return caps;
}

/** Guard against malformed upstream/cached payloads before mapping them. */
export function isModelsResponse(value: unknown): value is OpenRouterModelsResponse {
  return (
    typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
  );
}

/** Guard against malformed benchmark payloads before mapping them. */
export function isBenchmarksResponse(value: unknown): value is BenchmarksResponse {
  return (
    typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
  );
}

function toScore(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build a `model id → scores` lookup from the benchmarks response, keeping only
 * the Artificial Analysis entries (the same source as the three indices).
 */
export function parseScores(json: unknown): Map<string, ModelScores> {
  const scores = new Map<string, ModelScores>();
  if (!isBenchmarksResponse(json)) return scores;
  for (const entry of json.data) {
    if (entry.source !== "artificial-analysis") continue;
    const slug = entry.model_permaslug;
    if (!slug) continue;
    scores.set(slug, {
      intelligence: toScore(entry.intelligence_index),
      coding: toScore(entry.coding_index),
      agentic: toScore(entry.agentic_index),
    });
  }
  return scores;
}

/** Normalize an OpenRouter response into render-ready rows, attaching scores. */
export function parseModels(
  json: unknown,
  scores: ReadonlyMap<string, ModelScores> = new Map(),
): ModelInfo[] {
  if (!isModelsResponse(json)) return [];
  return json.data.map((model) => {
    const modelScores =
      scores.get(model.id) ?? scores.get(model.canonical_slug ?? "") ?? EMPTY_SCORES;
    return {
      id: model.id,
      name: model.name ?? model.id,
      provider: extractProvider(model.id),
      contextLength: model.context_length ?? model.top_provider?.context_length ?? null,
      inputPricePerMillion: pricePerMillion(model.pricing?.prompt),
      outputPricePerMillion: pricePerMillion(model.pricing?.completion),
      capabilities: capabilitiesOf(model),
      ...modelScores,
    };
  });
}

/** Fetch a JSON endpoint, caching the raw body and failing on non-2xx. */
async function fetchJsonCached(store: ModelCache, url: string, apiKey: string): Promise<unknown> {
  const cached = await store.match(url);
  if (cached) return await cached.json();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new ModelsFetchError(response.status);
  }

  const json: unknown = await response.json();
  const cacheable = new Response(JSON.stringify(json), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await store.put(url, cacheable);
  return json;
}

/**
 * Fetch OpenRouter model metadata and Artificial Analysis scores, caching each
 * raw response for 15 minutes and joining scores onto models.
 *
 * The OpenRouter API key is read server-side only; it never leaves the Worker
 * and is never embedded in the cached or rendered output.
 */
export async function getModels(env: Env, cache?: ModelCache): Promise<ModelInfo[]> {
  const store = cache ?? (await caches.open("models"));
  const apiKey = openRouterApiKey(env);

  const [modelsJson, benchmarksJson] = await Promise.all([
    fetchJsonCached(store, MODELS_URL, apiKey),
    fetchJsonCached(store, BENCHMARKS_URL, apiKey),
  ]);

  return parseModels(modelsJson, parseScores(benchmarksJson));
}
