#!/usr/bin/env node
/**
 * Validate the OpenCode example configuration.
 *
 * Checks that `opencode.example.json` parses, references the two proxy env
 * vars, and contains no real hostname or API key. No dependencies.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "opencode-openrouter-proxy",
  "opencode.example.json",
);

const raw = readFileSync(file, "utf8");
const lower = raw.toLowerCase();

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${name}`);
  if (!ok) failures.push(name);
};

let config;
try {
  config = JSON.parse(raw);
  check("opencode.example.json parses as JSON", true);
} catch (error) {
  console.error(`FAIL - JSON parse error: ${error.message}`);
  process.exit(1);
}

const options = config?.provider?.openrouter?.options ?? {};
check(
  "$schema is https://opencode.ai/config.json",
  config.$schema === "https://opencode.ai/config.json",
);
check("baseURL is {env:OPENROUTER_PROXY_URL}", options.baseURL === "{env:OPENROUTER_PROXY_URL}");
check("apiKey is {env:OPENROUTER_PROXY_TOKEN}", options.apiKey === "{env:OPENROUTER_PROXY_TOKEN}");
check("no openrouter.ai hostname reference", !lower.includes("openrouter.ai"));
check("no real OpenRouter API key (sk-or-)", !lower.includes("sk-or"));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll OpenCode config checks passed.");
