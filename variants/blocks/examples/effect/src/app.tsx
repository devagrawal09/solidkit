// The effect demo: two tabs (Typeahead, Checkout) and the fiber event log.
import { Errored, Show } from "solid-js";
import { block, field } from "@solidkit/blocks";
import { Checkout, type Model as CheckoutModel } from "./checkout.tsx";
import { EventLog, type Model as EventLogModel } from "./event-log.tsx";
import type { Services } from "./services.ts";
import { Typeahead, type Model as TypeaheadModel } from "./typeahead.tsx";

export type Tab = "typeahead" | "checkout";
export type Model = { tab: Tab; typeahead: TypeaheadModel; checkout: CheckoutModel; log: EventLogModel };
export type Msg = { type: "ClickedTab"; tab: Tab };

export const App = block<{ model: Model; msg: Msg; services: Services }>()({
  name: "effect",
  requires: { registry: true, shop: true },
  children: { typeahead: field(Typeahead), checkout: field(Checkout), log: field(EventLog) },
  init: () => ({ tab: "typeahead" }),
  update(model, msg, ctx) {
    if (msg.tab === model.tab) return;
    // The original unmounts the hidden tab, which resets it (and interrupts a
    // search in flight); here the tab being left is reset through its operation.
    if (model.tab === "typeahead") ctx.blocks.typeahead.reset();
    else ctx.blocks.checkout.reset();
    model.tab = msg.tab;
  },
  view: props => (
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
            Two demos, one tiny integration (<code>src/solid-effect.ts</code>): Effects as interruptible async sources on the
            read path, Effect sagas as transaction steps on the action path, services provided through Solid context.
          </p>
          <nav class="tabs">
            <button class={{ selected: props.model.tab === "typeahead" }} onClick={() => props.send({ type: "ClickedTab", tab: "typeahead" })}>
              Typeahead <small>read path</small>
            </button>
            <button class={{ selected: props.model.tab === "checkout" }} onClick={() => props.send({ type: "ClickedTab", tab: "checkout" })}>
              Checkout <small>action path</small>
            </button>
          </nav>
        </header>
        <main>
          <Show when={props.model.tab === "typeahead"} fallback={<props.blocks.checkout />}>
            <props.blocks.typeahead />
          </Show>
          <props.blocks.log />
        </main>
      </div>
    </Errored>
  )
});
