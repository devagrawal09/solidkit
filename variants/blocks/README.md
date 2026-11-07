# solid-kit · Blocks variant

The Messages design (facts → `update(draft)` → action requests → Solid-action
handlers, `onActionError`, subscriptions, injected services) plus composition
modelled on Foldkit's Blocks preview: a **block** bundles one feature, and a
parent connects children with **bindings**. Built on `@solidkit/kernel`
(timeline, snapshots, recorded services) and Solid 2.0.0-rc.19.

```
core/                 @solidkit/blocks: src/index.ts (library), src/testing.ts (test helpers), test/
examples/todos        NewTodo + TodoList under a root block
examples/effect       Typeahead + Checkout + EventLog under a root block (Effect 3.22)
examples/hackernews   router Shell + keyed page blocks (Feed, StoryPage, UserPage)
```

## The API in one screen

```tsx
import { block, driven, field, keyed, run, variants } from "@solidkit/blocks";

// A block declares its type bag once (only model and msg are required), then its spec.
export const TodoList = block<{ model: Model; msg: Msg; act: Act; out?: Out; services: { api: Api }; args: { hash: string } }>()({
  name: "TodoList",
  requires: { api: true },                // every service, listed: checked by type here and at run() time
  init: args => ({ filter: parseHash(args.hash), failures: {} }),
  data: (model, services, ctx) => ({...}), // async memos, optimistic stores, projections; ctx.refreshable(source)
  update: (draft, msg, ctx) => act,       // mutate the draft; return Act | Act[] | void
                                          // ctx.data, ctx.emit(out), ctx.blocks.<child>.<operation>(...), ctx.key
  actions: (data, services, ctx) => ({    // one Solid action per Act type: optimistic write, yield, refresh
    *addTodo(act) { ... },                // ctx.send(msg) lands with the action's transition
    placeOrder: driven(effectAction, function* (act) { ... }), // another action driver; ctx.interrupt("placeOrder")
  }),
  onActionError: (act, error) => Msg.SaveFailed({ act }),     // applied inside the failing action's transition
  subscriptions: (model, data) => [{ key: "hashchange", start: send => stop }],
  operations: { add: (todo: NewTodo) => Msg.RequestedAdd(todo) }, // the only way a parent changes this block
  view: props => <section>...</section>,  // props.model (read-only), props.send, props.data, props.blocks, inputs
});

// A parent binds children to fields of its model. Child messages route themselves;
// the parent changes a child only through its operations and must fold every out-message.
export const App = block<{ model: { header: NewTodoModel; list: TodoListModel }; msg: never; services: { api: Api } }>()({
  name: "todos",
  requires: { api: true },                // must cover the children's requirements (checked at each binding)
  children: { header: field(NewTodo), list: field(TodoList, { init: (args: Args) => args }) },
  //          keyed(Block, { initial }) binds a Record<string, ChildModel> field: one instance per key
  init: () => ({}),                       // own fields only; bindings build the children's
  update: () => {},
  out: { header: { EnteredTitle: (out, model, ctx) => ctx.blocks.list.add(out) } },
  view: props => <><props.blocks.header /><props.blocks.list /></>, // keyed: <props.blocks.pages key={id} />
});

const app = run(App, { kernel, services: { api }, args: { hash: location.hash } }); // under an owner
// <app.View />, app.send(msg), app.at("list").send(msg) / .state(seq) / .data, app.model
```

Testing (`@solidkit/blocks/testing`): `testUpdate(block, model, msg, { data })` and
`testOut(parent, child, out, model)` run one update on a copy and return
`{ model, acts, outs, ops }`; `start(block, { services, args, render })` runs a whole
app, or any one block, against `scripted(kernel)` services; `transitions(kernel)`
and `liveCalls(kernel)` read the timeline.

What the runtime guarantees:

- **One store, one timeline.** The root's model contains every child's model (a
  field, or a keyed record), so the kernel tracks one store. Each transition is
  committed with the block's path as its source (`todos/list · ToggledTodo`,
  `hn/stories[30186326] · ToggledComment`, `todos · header.EnteredTitle` for a
  fold). Actions are recorded as `todos/list:toggleTodo start/settled/failed`.
- **Elm order.** A dispatch cycle applies the message, the operations it calls
  and the folds of its out-messages, then flushes, then starts the requested
  actions. (Solid holds a write made in the same tick as an action's start until
  that action settles, so without the flush a cleared input would stay full until
  the save finished.)
- **Messages from inside actions** (`ctx.send`, `onActionError`) are applied at
  once, so they join the action's transition and land with its optimistic revert,
  and are committed when that transition lands (a snapshot taken mid-transition
  does not show them).
- **Keyed instances** are created from the model's keys (updates, time travel) and
  disposed, with their data, actions and subscriptions, when the key goes or their
  owner is disposed. Messages to a disposed instance are dropped with a note.
- **Services** are wrapped once by `run()` with `kernel.services`; each block only
  gets the services it lists. Missing services fail assembly with the block path
  that needs them. Closing a recorded AsyncIterable closes its source at once (see
  NOTES: the kernel's recorder alone would let a superseded Effect fiber finish).
- **Input is ignored while rewound** (views, subscriptions and late action results
  all go through `kernel.live`).

## How each example is structured

**todos** (`src/`): `api.ts` (the original mock API, unchanged), `new-todo.tsx`
(NewTodo: draft text; reports `EnteredTitle`), `todo-list.tsx` (TodoList: filter
and per-todo failures in the model; data is an optimistic store over
`api.getTodos` with a projection that layers failures on top, so a failed add stays
visible; five actions; `SaveFailed` fans bulk failures out to one retry per todo;
`Saved` clears them; hashchange subscription; operation `add`), `app.tsx` (root:
binds both, folds `EnteredTitle` into `list.add`, `<Errored>` and `<Loading>`),
`main.tsx`.

**effect** (`src/`): `api.ts` and `solid-effect.ts` copied unchanged; `log.ts` is now
an event source; `services.ts` wraps each Effect program with `runEffect` (so every
call is an interruptible AsyncIterable through `kernel.services`) and adds `step()`,
which runs a recorded call as one saga step; `typeahead.tsx` (query in the model,
one memo returning `registry.search(q)`, `latest`/`isPending` for stale results,
`<Errored>` with "Try again"); `checkout.tsx` (cart, decline flag and notice in the
model; orders as an optimistic store; the step indicator as `createOptimistic`; the
saga is `driven(effectAction, …)` with compensation in its catch; cancel is an
action calling `ctx.interrupt("placeOrder")`; `onActionError` maps
`CardDeclinedError`/`ActionInterruptedError` to notices); `event-log.tsx` (entries in
the model, fed by a subscription); `app.tsx` (root: tabs; leaving a tab resets it
through its `reset` operation, as unmounting did in the original); `main.tsx` mounts
under `<RuntimeContext value={createRuntime(SearchConfigLive)}>`.

**hackernews** (`src/`): `routes.ts` (typed `Route` union, `parse`, `href`,
`pageKey`), `hn.ts` (browser fetches to node-hnapi and Firebase; story 30186326
from `public/story-30186326.json`), `shell.tsx` (root: route in the model; link
clicks, popstate and hover/focus intent are subscriptions; three keyed bindings
`feeds`, `stories`, `users`; navigating or pointing at a link opens that page's
instance, the most recent `keep` (20) are kept and older ones removed, which
disposes them), `pages/feed.tsx`, `pages/story-page.tsx` (collapsed threads in the
model), `pages/user-page.tsx` (each with one memo over its service), `components/`
(the original markup). The current page stays on screen while the next one loads:
the new page's view reads its instance's pending memo, so Solid holds the
navigation; a preloaded page shows at once; back/forward reuse instances.

## Time travel, devtools and tests

- **Time travel.** `kernel.rewind(seq)` restores the one store (nested and keyed
  models alike); keyed instances follow their keys; every `data` source registered
  with `ctx.refreshable` re-derives from replayed responses, so no request goes
  out. Each example has a test that rewinds, checks the screen and the restored
  state, and asserts no live calls (`liveCalls`, `script.expectNoCalls`). Rewinding
  to an entry before a response was recorded shows that read as still pending
  (the kernel notes "no recording"), which is what the app showed then.
- **Devtools.** Every example mounts `<Devtools kernel={kernel} />`. Sources are
  block paths; payloads are the messages (operations add `via: "add() from
  todos"`).
- **Tests.** Pure tests call `testUpdate`/`testOut` on blocks (no Solid, no
  services). Scenario tests `start()` the real app against scripted services and
  drive the rendered DOM in happy-dom. The effect example also has one live test
  running the real Effect programs to show a fiber's interrupt finalizer firing.

| | tests | typecheck | build JS (gzip) |
| --- | --- | --- | --- |
| core | 17 | pass | – |
| todos | 16 (9 pure, 7 scenario) | pass | 109.6 kB (40.0 kB) |
| effect | 15 (6 pure, 8 scenario, 1 live) | pass | 258.3 kB (88.3 kB) |
| hackernews | 13 (5 pure, 8 scenario) | pass | 99.7 kB (36.3 kB) |

## Parity gaps against the originals

**todos**
- The header input is controlled: the draft is model state and each keystroke is
  a transition (the original reads the DOM on Enter). Ids are made in the
  keydown handler and carried by the message.
- A successful save is a `Saved` transition (it clears that todo's failure),
  where the original deletes from a side map inside the action.
- Clicking a checkbox while rewound is ignored; Solid writes the bound value back
  and warns `UNCOMMITTED_INPUT_OVERWRITTEN` in dev.

**effect**
- Tabs keep their blocks alive; leaving a tab resets it through an operation. A
  saga still running when you leave Checkout continues and its notice lands on
  the reset model (the original's component signals are disposed).
- Orders are fetched when the app starts (all block data exists from the start),
  not each time the Checkout tab mounts.
- The step indicator is an optimistic signal (it must show during the
  transition, and model writes inside an action are held), so it is not in
  snapshots: rewinding into a running saga does not show its phase.
- Saga steps are recorded service calls: `yield* step(shop.charge(total, decline))`
  instead of `yield* chargeCard(total, decline)`; finalizers and compensation are
  unchanged.
- Interrupting a search superseded by the next keystroke happens when Solid
  closes the flight, which an `isPending` reader can delay (Solid issue #3122,
  documented in the original). Leaving the tab interrupts at once (live test).
- Replayed errors are `Error(message)`, so the error box text can differ from
  the live one; every fiber event is a timeline entry, delivered one task later.

**hackernews**
- Client-rendered, no SSR or hydration, no `@solidjs/router`.
- The page cache is the keyed instances (20 most recent). Revisits reuse them
  without revalidating; preloading opens instances, so each first hover over a
  new link is a `PointedAt` transition.
- `history.pushState` is called directly by the `pushUrl` action (not a
  service), so the URL bar does not follow time travel. Scroll to top happens on
  click.
- Comment collapse is model state (it survives navigating away and back while
  the instance lives); the original uses native `<details>`.
- "Page not found." and the error box with "Try again" are additions; an unknown
  user is an error. The `User-Agent` header is dropped.
