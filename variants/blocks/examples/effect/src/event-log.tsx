// EventLog: the fiber event panel. Entries arrive through a subscription to
// log.ts, so each one is a message (a timeline entry) and the list is model
// state that time travel restores.
import { For, Show } from "solid-js";
import { block, variants } from "@solidkit/blocks";
import { onLog, type LogEntry } from "./log.ts";

export type Model = { entries: LogEntry[] };

export type Msg = { type: "Logged"; entry: LogEntry } | { type: "ClickedClear" };
export const Msg = variants<Msg>();

const LIMIT = 100;

export function update(model: Model, msg: Msg): void {
  if (msg.type === "ClickedClear") {
    model.entries.length = 0;
    return;
  }
  model.entries.push(msg.entry);
  if (model.entries.length > LIMIT) model.entries.splice(0, model.entries.length - LIMIT);
}

export const EventLog = block<{ model: Model; msg: Msg }>()({
  name: "EventLog",
  requires: {},
  init: () => ({ entries: [] }),
  update,
  // Effect programs log from inside fibers, at times synchronously inside a
  // saga step. Delivering on a later task keeps the entry out of that action's
  // transition, so it shows at once (as in the original).
  subscriptions: () => [
    {
      key: "fiber-events",
      start: send => onLog(entry => void setTimeout(() => send(Msg.Logged({ entry }))))
    }
  ],
  view: props => (
    <aside class="log-panel">
      <header>
        <h2>Fiber events</h2>
        <button onClick={() => props.send(Msg.ClickedClear())}>Clear</button>
      </header>
      <Show when={props.model.entries.length > 0} fallback={<p class="empty">Interact to see fiber lifecycle events.</p>}>
        <ul>
          <For each={[...props.model.entries].reverse()}>
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
  )
});
