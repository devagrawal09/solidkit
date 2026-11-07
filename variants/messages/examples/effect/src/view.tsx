import { Errored, For, isPending, latest, Loading, Show, type Accessor } from "solid-js";
import { program, type Send, type View } from "@solidkit/messages";
import type { Package } from "./api.ts";
import type { LogEntry } from "./log.ts";
import { effectDemo, Msg, total, type Data, type Model, type Phase } from "./app.ts";

// ── Typeahead (read path) ─────────────────────────────────────────────────────

function formatDownloads(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

function Results(props: { results: Accessor<Package[]>; query: string }) {
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

function Typeahead(props: { query: string; results: Accessor<Package[]>; send: Send<Msg> }) {
  return (
    <section class="panel">
      <header>
        <h2>Typeahead search</h2>
        <p>
          Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35% transient failure
          rate). Superseded flights are <em>interrupted</em>, not ignored — Solid cleans up the stale run, which
          interrupts its fiber.
        </p>
      </header>
      <input
        type="search"
        placeholder="Search packages… (try typing “solid” quickly)"
        value={props.query}
        onInput={e => props.send(Msg.ChangedQuery({ text: e.currentTarget.value }))}
        autofocus
      />
      <Show when={props.query.trim()}>
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
              <Results results={props.results} query={q()} />
            </Loading>
          </Errored>
        )}
      </Show>
    </section>
  );
}

// ── Checkout (action path) ────────────────────────────────────────────────────

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "reserving", label: "Reserve inventory" },
  { phase: "charging", label: "Charge card" },
  { phase: "finalizing", label: "Create order" }
];

function Checkout(props: { model: Model; data: Data; send: Send<Msg> }) {
  const inFlight = () => props.data.phase() !== "idle";
  const stepState = (step: Phase) => {
    const order: Phase[] = ["reserving", "charging", "finalizing"];
    const current = order.indexOf(props.data.phase());
    const target = order.indexOf(step);
    if (current === -1) return "";
    return target < current ? "done" : target === current ? "active" : "";
  };
  return (
    <section class="panel">
      <header>
        <h2>Checkout saga</h2>
        <p>
          Three Effect steps inside one Solid action transaction. Cancel mid-charge (it takes ~2.6s) or toggle the
          decline: the fiber is interrupted, compensations run server-side, and the optimistic UI reverts —
          automatically on both sides.
        </p>
      </header>

      <div class="cart">
        <For each={props.model.cart}>
          {item => (
            <div class="cart-row">
              <span class="cart-name">{item.name}</span>
              <span class="qty">
                <button
                  disabled={inFlight() || item.quantity <= 1}
                  onClick={() => props.send(Msg.ChangedQuantity({ id: item.id, by: -1 }))}
                >
                  −
                </button>
                {item.quantity}
                <button disabled={inFlight()} onClick={() => props.send(Msg.ChangedQuantity({ id: item.id, by: 1 }))}>
                  +
                </button>
              </span>
              <span class="cart-price">${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          )}
        </For>
        <div class="cart-row total">
          <span class="cart-name">Total</span>
          <span class="cart-price">${total(props.model.cart).toFixed(2)}</span>
        </div>
      </div>

      <div class="checkout-controls">
        <label class="decline-toggle">
          <input
            type="checkbox"
            checked={props.model.declineCard}
            onInput={e => props.send(Msg.ToggledDecline({ decline: e.currentTarget.checked }))}
          />
          Simulate card decline (typed <code>CardDeclinedError</code>)
        </label>
        <Show
          when={inFlight()}
          fallback={
            <button class="primary" onClick={() => props.send(Msg.ClickedPlaceOrder())}>
              Place order — ${total(props.model.cart).toFixed(2)}
            </button>
          }
        >
          <button class="danger" onClick={() => props.send(Msg.ClickedCancel())}>
            Cancel checkout
          </button>
        </Show>
      </div>

      <ol class="steps">
        <For each={STEPS}>
          {step => (
            <li class={{ done: stepState(step.phase) === "done", active: stepState(step.phase) === "active" }}>
              {step.label}
            </li>
          )}
        </For>
      </ol>

      <Show when={props.model.notice}>{n => <p class={["notice", n().kind]}>{n().text}</p>}</Show>

      <h3>Your orders</h3>
      <Loading fallback={<p class="loading">Loading orders…</p>}>
        <Show when={props.data.orders.length > 0} fallback={<p class="empty">No orders yet.</p>}>
          <ul class="orders">
            <For each={props.data.orders}>
              {order => (
                <li>
                  <span class="pkg-name">{order.id}</span>
                  <span class="pkg-desc">
                    {order.items.length} line{order.items.length === 1 ? "" : "s"} · placed {order.placedAt}
                  </span>
                  <span class="cart-price">${order.total.toFixed(2)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>
    </section>
  );
}

// ── Event log ─────────────────────────────────────────────────────────────────

function LogPanel(props: { log: LogEntry[]; send: Send<Msg> }) {
  return (
    <aside class="log-panel">
      <header>
        <h2>Fiber events</h2>
        <button onClick={() => props.send(Msg.ClickedClearLog())}>Clear</button>
      </header>
      <Show when={props.log.length > 0} fallback={<p class="empty">Interact to see fiber lifecycle events.</p>}>
        <ul>
          <For each={[...props.log].reverse()}>
            {entry => (
              <li class={`log-${entry.kind}`}>
                <span class="log-time">{entry.time}</span>
                <span class="log-kind">{entry.kind}</span>
                <span class="log-msg">{entry.message}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </aside>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export const view: View<Model, Msg, Data> = (model, send, data) => (
  <Errored
    fallback={(err, reset) => (
      <div class="error-box app-error">
        <p>Something went wrong: {String(err())}</p>
        <button onClick={reset}>Reset</button>
      </div>
    )}
  >
    <div class="app">
      <header class="app-header">
        <h1>
          Solid 2.0 <span class="times">×</span> Effect
        </h1>
        <p>
          Two demos, one tiny integration (<code>src/solid-effect.ts</code>): Effects as interruptible async sources on
          the read path, Effect sagas as transaction steps on the action path — here driven by messages, with every
          call on the solid-kit timeline.
        </p>
        <nav class="tabs">
          <button class={{ selected: model.tab === "typeahead" }} onClick={() => send(Msg.ClickedTab({ tab: "typeahead" }))}>
            Typeahead <small>read path</small>
          </button>
          <button class={{ selected: model.tab === "checkout" }} onClick={() => send(Msg.ClickedTab({ tab: "checkout" }))}>
            Checkout <small>action path</small>
          </button>
        </nav>
      </header>
      <main>
        <Show when={model.tab === "typeahead"} fallback={<Checkout model={model} data={data} send={send} />}>
          <Typeahead query={model.query} results={data.results} send={send} />
        </Show>
        <LogPanel log={model.log} send={send} />
      </main>
    </div>
  </Errored>
);

export const App = program({ ...effectDemo, view });
