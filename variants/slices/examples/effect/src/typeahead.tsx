// Read path: the results memo lives in shop.ts; this is the original view.
// Pending flows to <Loading>, exhausted retries flow to <Errored>,
// latest/isPending give stale-while-revalidate.
import { Errored, For, isPending, latest, Loading, Show } from "solid-js";
import type { Package } from "./api";
import { Shop } from "./shop";

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
        fallback={
          <p class="empty">
            {isPending(props.results) ? "Searching…" : `No packages match “${props.query}”.`}
          </p>
        }
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

export function Typeahead() {
  const { search, queryChanged, results } = Shop.use();
  return (
    <section class="panel">
      <header>
        <h2>Typeahead search</h2>
        <p>
          Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35%
          transient failure rate). Superseded flights are <em>interrupted</em>, not ignored — Solid
          closes the stale iterator, <code>runEffect</code> interrupts the fiber.
        </p>
      </header>
      <input
        type="search"
        placeholder="Search packages… (try typing “solid” quickly)"
        value={search.query}
        onInput={e => queryChanged(e.currentTarget.value)}
        autofocus
      />
      <Show when={search.query.trim()}>
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
              <Results results={results} query={q()} />
            </Loading>
          </Errored>
        )}
      </Show>
    </section>
  );
}
