import { jsx } from "hono/jsx";
import { describe, expect, it } from "vitest";

import {
  extractProvider,
  parseModels,
  parseScores,
  pricePerMillion,
} from "../src/models/fetch-models";
import {
  formatContext,
  formatPricePerMillion,
  formatScore,
  ModelRow,
} from "../src/models/models-page";
import type { ModelInfo, ModelScores, OpenRouterModelsResponse } from "../src/models/types";

const response: OpenRouterModelsResponse = {
  data: [
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      context_length: 200000,
      architecture: { modality: "text->text" },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "structured_outputs"],
      top_provider: { context_length: 200000 },
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      context_length: 128000,
      architecture: { modality: "text+image->text" },
      pricing: { prompt: "0.0000025", completion: "0.00001" },
      supported_parameters: ["tools"],
    },
    { id: "deepseek/deepseek-chat" },
  ],
};

describe("extractProvider", () => {
  it("extracts the vendor prefix from a model id", () => {
    expect(extractProvider("anthropic/claude-3.5-sonnet")).toBe("anthropic");
    expect(extractProvider("openai/gpt-4o")).toBe("openai");
    expect(extractProvider("deepseek/deepseek-chat")).toBe("deepseek");
  });

  it("returns the whole id when there is no slash", () => {
    expect(extractProvider("gpt-4o")).toBe("gpt-4o");
  });

  it("returns an empty string for an empty id", () => {
    expect(extractProvider("")).toBe("");
  });
});

describe("pricePerMillion", () => {
  it("converts a per-token price to dollars per 1M tokens", () => {
    expect(pricePerMillion("0.000003")).toBe(3);
    expect(pricePerMillion("0.0000025")).toBe(2.5);
    expect(pricePerMillion("0")).toBe(0);
  });

  it("returns null for missing, empty, or non-numeric prices", () => {
    expect(pricePerMillion(undefined)).toBeNull();
    expect(pricePerMillion("")).toBeNull();
    expect(pricePerMillion("not-a-number")).toBeNull();
  });
});

describe("parseScores", () => {
  it("maps artificial-analysis indices by model permaslug", () => {
    const scores = parseScores({
      data: [
        {
          source: "artificial-analysis",
          model_permaslug: "openai/gpt-4o",
          intelligence_index: 71.2,
          coding_index: 65.8,
          agentic_index: 58.3,
        },
        {
          source: "openrouter",
          model_permaslug: "openai/gpt-4o",
          accuracy: 0.72,
        },
      ],
    });
    expect(scores.get("openai/gpt-4o")).toEqual({
      intelligence: 71.2,
      coding: 65.8,
      agentic: 58.3,
    });
  });

  it("ignores non-artificial-analysis entries and missing slugs", () => {
    const scores = parseScores({
      data: [
        { source: "openrouter", model_permaslug: "a/b", intelligence_index: 1 },
        { source: "artificial-analysis" },
      ],
    });
    expect(scores.size).toBe(0);
  });

  it("returns an empty map for malformed input", () => {
    expect(parseScores("nope").size).toBe(0);
    expect(parseScores(null).size).toBe(0);
  });
});

describe("parseModels", () => {
  it("normalizes model metadata into render-ready rows", () => {
    const models = parseModels(response);
    expect(models).toHaveLength(3);

    expect(models[0]).toEqual({
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "anthropic",
      contextLength: 200000,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      capabilities: ["text → text", "tools"],
      intelligence: null,
      coding: null,
      agentic: null,
    });

    expect(models[1]?.contextLength).toBe(128000);
    expect(models[1]?.inputPricePerMillion).toBe(2.5);
    expect(models[1]?.capabilities).toEqual(["text+image → text", "tools"]);
  });

  it("joins scores onto models by id", () => {
    const scores = new Map<string, ModelScores>([
      ["openai/gpt-4o", { intelligence: 71.2, coding: 65.8, agentic: 58.3 }],
    ]);
    const models = parseModels(response, scores);
    expect(models[1]?.intelligence).toBe(71.2);
    expect(models[1]?.coding).toBe(65.8);
    expect(models[1]?.agentic).toBe(58.3);
    // Unscored models stay null.
    expect(models[0]?.intelligence).toBeNull();
  });

  it("falls back to the id as name and nulls for missing fields", () => {
    const models = parseModels(response);
    const bare = models[2];
    expect(bare?.name).toBe("deepseek/deepseek-chat");
    expect(bare?.provider).toBe("deepseek");
    expect(bare?.contextLength).toBeNull();
    expect(bare?.inputPricePerMillion).toBeNull();
    expect(bare?.outputPricePerMillion).toBeNull();
    expect(bare?.intelligence).toBeNull();
    expect(bare?.capabilities).toEqual([]);
  });

  it("falls back to the top_provider context length", () => {
    const json: OpenRouterModelsResponse = {
      data: [{ id: "x/y", top_provider: { context_length: 8192 } }],
    };
    expect(parseModels(json)[0]?.contextLength).toBe(8192);
  });
});

describe("price and context formatting", () => {
  it("formats dollars per million readably", () => {
    expect(formatPricePerMillion(3)).toBe("$3.00");
    expect(formatPricePerMillion(2.5)).toBe("$2.50");
    expect(formatPricePerMillion(0)).toBe("$0.00");
    expect(formatPricePerMillion(null)).toBe("—");
  });

  it("formats context length with thousands separators", () => {
    expect(formatContext(200000)).toBe("200,000");
    expect(formatContext(null)).toBe("—");
  });

  it("formats scores to one decimal place", () => {
    expect(formatScore(71.2)).toBe("71.2");
    expect(formatScore(65)).toBe("65.0");
    expect(formatScore(null)).toBe("—");
  });
});

describe("model row rendering", () => {
  it("renders a row with readable prices, scores, provider, and context", () => {
    const model: ModelInfo = {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "anthropic",
      contextLength: 200000,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      capabilities: ["text → text", "tools"],
      intelligence: 80.5,
      coding: 75.2,
      agentic: 60,
    };
    const html = String(jsx(ModelRow, { model }));

    expect(html).toContain("anthropic/claude-3.5-sonnet");
    expect(html).toContain(">anthropic</td>");
    expect(html).toContain("200,000");
    expect(html).toContain("$3.00");
    expect(html).toContain("$15.00");
    expect(html).toContain("80.5");
    expect(html).toContain("75.2");
    expect(html).toContain("60.0");
    expect(html).toContain("text → text, tools");
    expect(html).toContain('data-provider="anthropic"');
    expect(html).toContain('data-intelligence="80.5"');
  });
});
