/**
 * Types for the OpenRouter `/api/v1/models` and `/api/v1/benchmarks` responses
 * and the normalized model rows rendered by `/models`.
 *
 * Only the fields the page needs are modeled; the upstream responses are far
 * larger and the rest is ignored.
 */

/** Subset of an OpenRouter model entry that the page consumes. */
export interface OpenRouterModel {
  id: string;
  name?: string;
  canonical_slug?: string;
  context_length?: number;
  architecture?: { modality?: string };
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  top_provider?: { context_length?: number };
}

/** Shape of `GET https://openrouter.ai/api/v1/models`. */
export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

/** One entry from `GET https://openrouter.ai/api/v1/benchmarks`. */
export interface BenchmarkEntry {
  source?: string;
  model_permaslug?: string;
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
}

/** Shape of `GET https://openrouter.ai/api/v1/benchmarks`. */
export interface BenchmarksResponse {
  data: BenchmarkEntry[];
}

/** Artificial Analysis indices for one model. */
export interface ModelScores {
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
}

/** A normalized, render-ready model row. */
export interface ModelInfo extends ModelScores {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  capabilities: string[];
}
