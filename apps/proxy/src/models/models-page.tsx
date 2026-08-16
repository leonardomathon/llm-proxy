import type { ModelInfo } from "./types";

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 1rem; font-family: system-ui, -apple-system, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
  h1 { font-size: 1.1rem; margin: 0; }
  input, select { padding: .35rem .5rem; font: inherit; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { border: 1px solid rgba(128,128,128,.35); padding: .3rem .5rem; white-space: nowrap; }
  thead th { position: sticky; top: 0; background: rgba(128,128,128,.18); cursor: pointer; user-select: none; text-align: left; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.id { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .8rem; }
  tbody tr:hover { background: rgba(128,128,128,.12); }
  footer { margin-top: .75rem; color: #888; font-size: .8rem; }
`;

const SCRIPT = `
  (function () {
    var q = document.getElementById("search");
    var provider = document.getElementById("provider");
    var table = document.getElementById("models");
    var tbody = table.tBodies[0];
    var count = document.getElementById("count");
    var sortKey = null;
    var sortDir = 1;

    function apply() {
      var query = q.value.trim().toLowerCase();
      var prov = provider.value;
      var visible = 0;
      for (var row of tbody.rows) {
        var id = (row.dataset.id || "").toLowerCase();
        var name = (row.dataset.name || "").toLowerCase();
        var show = (!prov || row.dataset.provider === prov) &&
                   (!query || name.indexOf(query) !== -1 || id.indexOf(query) !== -1);
        row.hidden = !show;
        if (show) visible++;
      }
      count.textContent = visible + " / " + tbody.rows.length + " models";
    }

    function sortRows() {
      var rows = Array.prototype.slice.call(tbody.rows);
      rows.sort(function (a, b) {
        var av = a.dataset[sortKey];
        var bv = b.dataset[sortKey];
        var an = av === "" || av === undefined ? -Infinity : Number(av);
        var bn = bv === "" || bv === undefined ? -Infinity : Number(bv);
        if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
      rows.forEach(function (row) { tbody.appendChild(row); });
    }

    q.addEventListener("input", apply);
    provider.addEventListener("change", apply);
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (!key) return;
        if (sortKey === key) sortDir = -sortDir;
        else { sortKey = key; sortDir = 1; }
        sortRows();
      });
    });
  })();
`;

export function formatPricePerMillion(usd: number | null): string {
  if (usd === null) return "—";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function formatContext(length: number | null): string {
  if (length === null) return "—";
  return length.toLocaleString("en-US");
}

export function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(1);
}

export function ModelRow({ model }: { model: ModelInfo }) {
  return (
    <tr
      data-id={model.id}
      data-name={model.name}
      data-provider={model.provider}
      data-context={model.contextLength ?? ""}
      data-input={model.inputPricePerMillion ?? ""}
      data-output={model.outputPricePerMillion ?? ""}
      data-intelligence={model.intelligence ?? ""}
      data-coding={model.coding ?? ""}
      data-agentic={model.agentic ?? ""}
    >
      <td class="id">{model.id}</td>
      <td>{model.provider}</td>
      <td class="num">{formatContext(model.contextLength)}</td>
      <td class="num">{formatPricePerMillion(model.inputPricePerMillion)}</td>
      <td class="num">{formatPricePerMillion(model.outputPricePerMillion)}</td>
      <td class="num">{formatScore(model.intelligence)}</td>
      <td class="num">{formatScore(model.coding)}</td>
      <td class="num">{formatScore(model.agentic)}</td>
      <td>{model.capabilities.join(", ")}</td>
    </tr>
  );
}

export function ModelsPage({ models }: { models: ModelInfo[] }) {
  const providers = [...new Set(models.map((m) => m.provider))].sort();

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Models</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <h1>Models</h1>
          <input id="search" type="search" placeholder="Search by model name" autocomplete="off" />
          <select id="provider">
            <option value="">All providers</option>
            {providers.map((p) => (
              <option value={p}>{p}</option>
            ))}
          </select>
        </header>
        <table id="models">
          <thead>
            <tr>
              <th data-sort="id">Model</th>
              <th data-sort="provider">Provider</th>
              <th data-sort="context" class="num">
                Context
              </th>
              <th data-sort="input" class="num">
                Input $/1M
              </th>
              <th data-sort="output" class="num">
                Output $/1M
              </th>
              <th data-sort="intelligence" class="num">
                Intelligence
              </th>
              <th data-sort="coding" class="num">
                Coding
              </th>
              <th data-sort="agentic" class="num">
                Agentic
              </th>
              <th>Capabilities</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <ModelRow model={m} />
            ))}
          </tbody>
        </table>
        <footer>
          <span id="count">{models.length} models</span>
        </footer>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      </body>
    </html>
  );
}

export function ErrorPage({ status, message }: { status: number; message: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Models unavailable</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <h1>Models unavailable</h1>
        <p>
          {message} (HTTP {status})
        </p>
        <p>
          <a href="/models">Try again</a>
        </p>
      </body>
    </html>
  );
}

/** Render the models page (returned as JSX, stringified by `c.html`). */
export function renderModelsPage(models: ModelInfo[]) {
  return <ModelsPage models={models} />;
}

/** Render the error page (returned as JSX, stringified by `c.html`). */
export function renderErrorPage(status: number, message: string) {
  return <ErrorPage status={status} message={message} />;
}
