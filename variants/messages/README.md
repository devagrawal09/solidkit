# solid-kit · messages

The Elm loop on Solid 2, with async left in Solid. The view sends **messages**
(facts). `update` mutates a draft of the model and returns **action requests**
(plain data). Each request runs as a **Solid action** (optimistic write, yield a
service, refresh). Server data is **derived** in `data`, never stored. Everything
goes through the shared kernel, so time travel, the devtools timeline and scripted
tests come along with it.

```
view ──send(Msg)──▶ update(draft, msg, data) ──▶ Act[] ──▶ handlers (Solid actions)
  ▲                    │ writes the model store              │ optimistic writes, services,
  │                    ▼                                     │ refresh; return a Msg on success;
  └──── model + data ◀─ data(model, services): memos,        │ onActionError(act, e) → Msg on
                        projections, optimistic stores ◀─────┘ failure (lands with the revert)
```

## The API in one screen

```ts
import { createProgram, program, variants, onWindow, onUrlRequest, onUrlChange, onLinkIntent, every,
         type ProgramSpec, type Handlers, type Subscription, type View, type Send } from "@solidkit/messages";
import { story, send, expectModel, expectActions, scenario, settled } from "@solidkit/messages/testing";

type Msg = { type: "ToggledTodo"; id: string; completed: boolean } | { type: "SavedTodos"; ids: string[] } | …;
const Msg = variants<Msg>();                 // typed constructors: Msg.ToggledTodo({ id, completed })
type Act = { type: "toggleTodo"; id: string; completed: boolean } | …;
const Act = variants<Act>();

const spec: ProgramSpec<Model, Msg, Act, Data, Services, Flags> = {
  name: "todos",                             // timeline source
  init: flags => model,                      // client state only
  update(model, msg, data) {                 // mutate the draft; return Act | Act[] | void; never waits
    if (msg.type === "ToggledTodo") return Act.toggleTodo({ id: msg.id, completed: msg.completed });
  },
  data: (model, services) => ({ todos }),    // memos / projections / optimistic stores (async ok)
  sources: data => [data.todos],             // what time travel refreshes (kernel.refreshable)
  actions: (data, services, model): Handlers<Act, Msg> => ({
    *toggleTodo({ id, completed }) {         // runs as a Solid action
      setTodos(t => { … pending: true });    // optimistic, reverts when the transition lands
      yield services.api.toggleTodo(id, completed);
      refresh(data.todos);
      return Msg.SavedTodos({ ids: [id] });  // success fact, sent inside the transition
    }
  }),
  onActionError: (act, error) => Msg.FailedToSave({ act }),  // failure fact, lands with the revert
  subscriptions: model => [onWindow("hashchange", () => Msg.ChangedHash({ hash: location.hash }))]
};

const App = program({ ...spec, view: (model, send, data) => <… /> });   // a component
<App kernel={kernel} services={{ api }} flags={location.hash} />
// or, under any owner: const { model, data, send } = createProgram(spec, { kernel, services, flags })

// tests
story({ update }, { model, data: fixture }, send(Msg.A(), Msg.B()), expectModel(m => …), expectActions(Act.x()));
const app = scenario(spec, { services, flags, view });   // real program, scripted kernel, rendered view
await app.script.resolve("api.getTodos", [todo]);         // waits for the call, answers it, settles
```

What `createProgram` does with the kernel:

| Kernel piece | Where |
| --- | --- |
| `kernel.track(name, model)` | the model store, created from `init(flags)` |
| `kernel.commit(name, msg.type, msg)` | every message, right after update applies it |
| `kernel.action(act.type, act, run)` | every requested action; a failure turned into a message still shows as `failed` |
| `kernel.services(services)` | the services you pass in (so every call is recorded, replayed, scripted) |
| `kernel.refreshable(...sources(data))` | the data sources, re-derived from replayed responses when the timeline moves |
| `kernel.live(msg.type)` | input is dropped while rewound (and the view is `inert`) |

Two rules the loop enforces, both found by probing Solid 2:

- **Model writes are never held by the actions they request.** An action opened in
  the same tick as a write owns that tick's flush, so `setModel` + `action()` would
  hide the write until the action settles (a cleared input would keep its text for
  400 ms). `send` applies update, commits, and starts the requested actions in
  `onFlush`, after the model write has landed.
- **Messages from inside an action land with its transition.** A handler's return
  value and `onActionError`'s message are sent while the handler's code runs (core
  steps the generator itself to know). Their model write is held with the
  transition, so a failure appears in the same frame as the optimistic revert (a
  core test checks every frame). Their kernel commit is deferred with `onSettled`, so
  the snapshot contains the write. If the action settles while you are rewound, the
  message is held and applied on resume.

## The examples

Each example is `src/<program>.ts` (model, messages, update, data, actions,
subscriptions, spec), `src/view.tsx` (the original's markup; `App = program({...spec, view})`),
`src/main.tsx` (kernel, `<App>`, `<Devtools>`), and `test/` (story tests of update,
scenario tests of the real program).

**todos** (`examples/todos`, port of `solid/examples/todos`). `api.ts` and `app.css`
are the original's (localStorage, 400 ms delays, 33% failed saves). Model: `filter`
(from the hash), `draft`, `failures` (per-item: *the action to retry*, first failure
wins). Data: `todos` (an optimistic store over `api.getTodos`) and `items` (a memo
that merges failed adds back in, in id order, so a failed add stays visible). Every
handler returns `SavedTodos` on success; `onActionError` sends `FailedToSave`, whose
update fans bulk failures out to per-item retries (toggle-all → `toggleTodo` each,
clear-completed → `removeTodo` each). Retry is `ClickedRetry` → update returns the
stored failure, unchanged.

**effect** (`examples/effect`, port of `solid/examples/effect`). `api.ts` and `app.css`
unchanged; `solid-effect.ts` is the original plus one helper; `log.ts` now emits
entries instead of owning a store. One program holds both demos: model `tab`,
`query`, `cart`, `declineCard`, `notice`, `log`. Read path: `results` is one memo keyed on
the query, calling the `search` service (retry ×3, backoff, 4 s timeout, typed errors),
with `latest`/`isPending` for stale-while-revalidate and an `<Errored>` with "Try
again". Action path: the `placeOrder` handler awaits the original `effectAction` saga,
whose steps are kernel services. `phase` is an optimistic signal in data;
`cancelCheckout` calls `placeOrder.interrupt()`; compensation runs in the saga's
catch; `onActionError` maps `CardDeclinedError` / `ActionInterruptedError` to
`CardDeclined` / `CheckoutCancelled`. The fiber log is a subscription: each entry is a
`Logged` message, so the panel is client state and rewinds.

**hackernews** (`examples/hackernews`, port of `solid/examples/hackernews-spa`,
client-only). Model: `{ route }`, a typed `Route` (`stories` type/page, `story` id, `user`
id, `notFound`) parsed from the URL. Link clicks (`onUrlRequest`), back/forward
(`onUrlChange`) and hover/focus/touch (`onLinkIntent`) are subscriptions. A click moves
the route and requests `pushUrl`, which runs through the `nav` service. Data is one
async memo `page` keyed on the route, so the current page stays up while the next
loads. A 30 s request cache in front of the recorded services (like the router's
`query()`) lets a preload and the navigation after it share a request. Fetching
happens in the browser (`src/hn.ts`): node-hnapi.herokuapp.com and
hacker-news.firebaseio.com both send CORS headers. Thread 30186326 is the original's
capture, served from `public/` so it isn't in the bundle. Components and `app.css` are
the original's.

## Time travel, devtools, tests

- **Time travel.** `kernel.rewind(seq)` restores the model from the snapshot after
  `seq` and refreshes the sources. Their service calls replay the latest recorded
  response at or before `seq`, so there is no network. The view is `inert` and `send`
  drops input until `resume()`. Every example has a test that rewinds, asserts the
  restored UI, and asserts no live (scripted) calls: todos (list before an add,
  draft text mid-typing), effect (cart, notice and orders before an order; the
  typeahead tab before switching; the fiber log), hackernews (front page and story,
  through the kernel's replay rather than the cache).
- **Devtools.** `<Devtools kernel={kernel} />` is mounted in every `main.tsx`. The
  timeline reads, for example, `todos · ToggledTodo`, `action toggleTodo start`,
  `api.toggleTodo call`, `api.toggleTodo error: Failed to Save`, `action toggleTodo
  failed: Failed to Save`, `todos · FailedToSave`. `window.__solidkit` is installed too.
- **Tests.** `story` runs update on a store draft with a data fixture: no DOM, no
  services, no async. `scenario` runs the real spec (data, actions,
  subscriptions) on a scripted kernel and renders the real view into happy-dom.
  Its `script.resolve/reject` wait for the call first, because actions start one
  flush after their message. The effect example also has two *live* tests that run
  the real Effect programs behind the real kernel, on Effect's `TestClock`. Sleeps
  end only when the test adjusts the clock, and the tests wait on log entries and
  the notice, never on a delay. A superseded search's fiber is interrupted (its
  finalizer logs, and the timeline shows the call erroring). A cancel during the
  charge step voids the charge (its own finalizer) before the saga releases the
  hold.

## Parity gaps (honest list)

- **todos.** Destroying a failed add only forgets it locally; the original also sends
  `removeTodo` to a server that never had it. Toggle-all and clear-completed act on
  the server's todos, not on failed adds; the original included them, and a
  successful toggle-all then silently dropped the failed adds. The per-item error is
  kept until a later save of that item succeeds, as in the original.
- **effect.** (1) Superseded searches are interrupted through the reading
  computation's `onCleanup` (`runEffectInterruptible`), not by Solid closing the
  iterator. The kernel wraps iterables in an `async function*`, whose `return()`
  waits behind the pending `next()`. A probe showed the stale source closing only
  after it produced (see NOTES). (2) Saga steps pass an `AbortSignal` through the
  service call, so it shows as `{}` in the logged args. (3) The query, cart and
  notice live in one model and survive tab switches; the original's components reset
  them on remount. (4) Every fiber event is a `Logged` transition, so this timeline is
  busy (the devtools filters by kind, not by name). The log reaches the model a task
  later than the original's direct store write (see NOTES). (5) Rewinding mid-checkout doesn't restore the step indicator: `phase` is
  transition-scoped optimistic state, like todos' `pending`.
- **hackernews.** No `@solidjs/router` (the dependency is unused): routes are client
  state, and the URL is an output (`pushUrl` action), so rewinding doesn't change the
  address bar. Scroll position and `<details>` collapse state aren't modeled. A
  missing user shows "not found" instead of throwing. The preload cache is the port's
  own 30 s map, not `query()`'s policy.
- **All.** Optimistic overlays of actions still in flight are not part of snapshots,
  so rewinding during a save shows the overlay over the replayed data until it
  settles. Input typed while rewound is blocked by `inert`. Programmatic and
  subscription input is dropped (and noted on the timeline).

## Commands

`pnpm typecheck`, `pnpm test`, `pnpm build` in `core` and in each `examples/*`.
