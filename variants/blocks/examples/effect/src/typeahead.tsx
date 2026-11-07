// Typeahead: one memo is the whole data layer. A new query re-runs it; Solid
// closes the superseded flight's iterator and runEffect interrupts the fiber
// (retries, timeout and finalizers included). The model is just the query.
import { createMemo, Errored, For, isPending, latest, Loading, Show } from "solid-js";
import { block, variants, type DataCtx } from "@solidkit/blocks";
import type { Package } from "./api.ts";
import type { Registry } from "./services.ts";

export type Model = { query: string };

export type Msg = { type: "ChangedQuery"; query: string } | { type: "RequestedReset" };
export const Msg = variants<Msg>();

export function update(model: Model, msg: Msg): void {
  model.query = msg.type === "ChangedQuery" ? msg.query : "";
}

export function data(model: Model, { registry }: { registry: Registry }, ctx: DataCtx) {
  const results = createMemo<Package[]>(() => {
    const q = model.query.trim();
    if (!q) return [];
    return registry.search(q);
  });
  ctx.refreshable(results);
  return { results };
}

function formatDownloads(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

function Results(props: { results: () => Package[]; query: string }) {
  const list = () => latest(props.results);
  return (
    <div class={{ results: true, stale: isPending(props.results) }}>
      <Show
        when={list().length > 0}
        fallback={<p class="empty">{isPending(props.results) ? "Searching…" : `No packages match “${props.query}”.`}</p>}
      >
        <ul>
          <For each={list()}>
            {pkg => (
              <li>
                <div>
                  <span class="pkg-name">{pkg.name}</span>
                  <span class="pkg-desc">{pkg.description}</span>
                </div>
                <span class="pkg-downloads">{formatDownloads(pkg.downloads)}/wk</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export const Typeahead = block<{ model: Model; msg: Msg; services: { registry: Registry } }>()({
  name: "Typeahead",
  requires: { registry: true },
  init: () => ({ query: "" }),
  data,
  update,
  operations: { reset: () => Msg.RequestedReset() },
  view: props => (
    <section class="panel">
      <header>
        <h2>Typeahead search</h2>
        <p>
          Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35% transient failure rate).
          Superseded flights are <em>interrupted</em>, not ignored — Solid closes the stale iterator, <code>runEffect</code>{" "}
          interrupts the fiber.
        </p>
      </header>
      <input
        type="search"
        placeholder="Search packages… (try typing “solid” quickly)"
        value={props.model.query}
        onInput={e => props.send(Msg.ChangedQuery({ query: e.currentTarget.value }))}
        autofocus
      />
      <Show when={props.model.query.trim()}>
        {q => (
          <Errored
            fallback={(err, reset) => (
              <div class="error-box">
                <p>Search gave up after retries: {String(err())}</p>
                <button onClick={reset}>Try again</button>
              </div>
            )}
          >
            <Loading fallback={<p class="loading">Searching…</p>}>
              <Results results={props.data.results} query={q()} />
            </Loading>
          </Errored>
        )}
      </Show>
    </section>
  )
});
