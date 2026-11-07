import { Errored, For, Show } from "solid-js";
import { Checkout } from "./checkout";
import { Shop, type ShopApp } from "./shop";
import { Typeahead } from "./typeahead";

function LogPanel() {
  const { eventLog, clearLog } = Shop.use();
  return (
    <aside class="log-panel">
      <header>
        <h2>Fiber events</h2>
        <button onClick={() => clearLog()}>Clear</button>
      </header>
      <Show
        when={eventLog.entries.length > 0}
        fallback={<p class="empty">Interact to see fiber lifecycle events.</p>}
      >
        <ul>
          <For each={[...eventLog.entries].reverse()}>
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

export function App(props: { shop: ShopApp }) {
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="error-box app-error">
          <p>Something went wrong: {String(err())}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <Shop.Context value={props.shop}>
        <div class="app">
          <header class="app-header">
            <h1>
              Solid 2.0 <span class="times">×</span> Effect
            </h1>
            <p>
              Two demos, one tiny integration (<code>src/solid-effect.ts</code>): Effects as
              interruptible async sources on the read path, Effect sagas as transaction steps on the
              action path, services provided through Solid context.
            </p>
            <nav class="tabs">
              <button
                class={{ selected: props.shop.shell.tab === "typeahead" }}
                onClick={() => props.shop.tabSelected("typeahead")}
              >
                Typeahead <small>read path</small>
              </button>
              <button
                class={{ selected: props.shop.shell.tab === "checkout" }}
                onClick={() => props.shop.tabSelected("checkout")}
              >
                Checkout <small>action path</small>
              </button>
            </nav>
          </header>
          <main>
            <Show when={props.shop.shell.tab === "typeahead"} fallback={<Checkout />}>
              <Typeahead />
            </Show>
            <LogPanel />
          </main>
        </div>
      </Shop.Context>
    </Errored>
  );
}
