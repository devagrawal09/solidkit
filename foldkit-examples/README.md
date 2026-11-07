# Solid examples, ported to the Foldkit Blocks and Effect Layers preview

Three apps from `solid/examples`, rebuilt on Foldkit's unreleased preview
(draft PR foldkit/foldkit#1655) for a side-by-side architecture comparison.

| Port | Original | What it exercises |
| --- | --- | --- |
| [`todos/`](todos) | `examples/todos` | Optimistic writes, per-item errors and retries, bulk calls, hash routing, crash view |
| [`effect/`](effect) | `examples/effect` | Interruptible searches, retry/backoff/timeout, a cancellable saga with compensation, a fiber event log |
| [`hackernews/`](hackernews) | `examples/hackernews-spa` | Typed routes, KeyedQuery caching, hover/focus preload, keep-page-while-loading, comment threads |

Field notes on the preview are in [NOTES.md](NOTES.md).

## Pinned target

- Docs: <https://foldkit-website-preview-ky42cyp8l-devin-jamesons-projects.vercel.app>
  (`/preview-release.json` reports `sourceCommit`
  `f3be22cfeefed437164ad614d08b16d9000e0703`, which matches the brief).
- Packages, exact: `foldkit@0.169.0-canary.f3be22cfeefe`,
  `@foldkit/vite-plugin@0.28.0-canary.f3be22cfeefe`,
  `@foldkit/devtools@0.169.0-canary.f3be22cfeefe`,
  `@foldkit/oxlint-plugin@0.15.3-canary.f3be22cfeefe`, with `effect@4.0.0` and
  `@effect/platform-browser@4.0.0`. `@foldkit/ui` is not used and was removed.
- Each app was scaffolded non-interactively with
  `npx create-foldkit-app@0.40.0-canary.f3be22cfeefe --name <app> --rendering spa --example counter --package-manager pnpm`
  and then replaced with the port. The scaffold's toolchain is kept as generated:
  TypeScript `7.1.0-beta` (native), Vite 8, Vitest 5, oxlint with the Foldkit and
  `@effect/tsgo` presets, oxfmt, and `@foldkit/devtools-mcp`. Tailwind was removed
  because the ports use the originals' CSS files unchanged.

## Running

Node 24 and pnpm 11. Each app is independent:

```sh
cd todos        # or effect, hackernews
pnpm install
pnpm dev        # todos → :3102, effect → :3107, hackernews → :3105
```

Each port listens 100 above its original (3002, 3007, 3005), so both can run at
once. DevTools is on in development (`devTools: { dispatch: true }`); the
overlay appears in the page, and `@foldkit/devtools-mcp` (configured in each
`.mcp.json`) can attach to the running app.

Checks, per app:

```sh
pnpm typecheck   # tsc --noEmit (includes the *.test.ts files)
pnpm lint        # oxlint: Foldkit preset, then the @effect/tsgo preset
pnpm test        # vitest: Story, Scene and handler tests
pnpm build       # vite build
```

### Results (final run)

| App | typecheck | lint | tests | build | `tsc --noEmit` wall (3 runs) |
| --- | --- | --- | --- | --- | --- |
| todos | pass | pass (0/0) | 16 passed, 3 files | pass, 432 kB JS (135 kB gz) | 0.40 s / 0.40 s / 0.40 s |
| effect | pass | pass (0/0) | 19 passed, 5 files | pass, 441 kB JS (138 kB gz) | 0.39 s / 0.39 s / 0.39 s |
| hackernews | pass | pass (0/0) | 9 passed, 2 files | pass, 459 kB JS (144 kB gz) | 0.38 s / 0.38 s / 0.38 s |

Each app was also driven in headless Chrome against `pnpm dev`, using the
scripts in [`smoke/`](smoke). The behaviors checked are listed per app below. The only
console error in those runs is the browser's `/favicon.ico` 404, as in the
originals, which ship no favicon. `vite build` prints one lightningcss warning
about `::input-placeholder` in the TodoMVC CSS, which comes from the original
stylesheet.

## todos

```
todos/src
├── entry.ts            Program: hash routing, crash view, DevTools
├── services.ts         ApplicationLayer = TodoApiLayer + localStorage KeyValueStore
├── api.ts              TodoApi Service and Layer (port of api.ts)
├── filter.ts           #/, #/active, #/completed → Filter
├── application.ts      root Block: Bindings, OutMessage fold, crash view
├── newTodo.ts          NewTodo Block (header input, OutMessage EnteredTitle)
├── todos/              Todos Block
│   ├── definition.ts   Model (the three layers), Message, Definition
│   ├── command.ts      8 Commands; handlers need TodoApi
│   ├── layers.ts       the layering, as a pure derivation
│   ├── update.ts       init and update
│   ├── view.ts         TodoMVC markup, view with inputs
│   ├── composition.ts, block.ts, index.ts
│   └── story.test.ts
├── story.test.ts, scene.test.ts
└── app.css             the original's TodoMVC CSS, unchanged
```

**Blocks and Bindings.** The root `Application` Block binds two children.
`NewTodo` owns the draft text and reports `EnteredTitle` as an OutMessage. The
root's OutMessage fold answers by calling the `Todos` Block's operation,
`TodosBinding.requestAddTodo({ title })`. That replaces Solid's `addTodo` from
context with a typed, parent-owned link between siblings. `Todos` renders
`section.todoapp` through `makeView.withInputs`; the root passes the filter and
a `renderHeader` callback, so the header Block lands inside the original markup.

**Layers.** Every Command handler asks for `TodoApi` when the Runtime builds the
application, and `services.ts` provides `TodoApiLayer` over
`BrowserKeyValueStore.layerLocalStorage`. The API keeps the original's
behavior: 400 ms per call, about 33% of saves failing without writing, and the
`"TODOS"` key.

**The layering.** Solid's three lifetimes (persisted list, error side channel,
optimistic overlay) are three Model fields. `layers.ts` derives what the view
shows by applying the errors over the persisted snapshot, then the in-flight
writes over that. Each write stays in the overlay until its re-read lands, and
its outcome (record or clear the per-item error) is committed in that same
update, as the original commits both in one transition. Bulk failures fan out
to one single-item error per affected todo.

Checked in the browser: `Loading…` first; optimistic adds with `pending`;
failed adds stay with `Retry addTodo` and succeed on retry; a single toggle
goes `pending` and then settles; a failed toggle-all leaves per-item
`Retry toggleTodo` buttons; hash filters work, including the back button; the
data lands in `localStorage["TODOS"]`.

### Parity gaps (todos)

- **Reset after a crash reloads the page.** Foldkit stops the Runtime on an
  unrecoverable error, and `crash.view` cannot dispatch. A failed *load* is a
  Message, though, and renders the same `.app-error` box with a working Reset
  (it reloads the list).
- **The header input is controlled** (its text is in the Model), where the
  original reads the DOM value on Enter. Behavior is the same.
- **Ids come from a Command** (`GenerateTodo`, using Clock and Random), so an
  add takes one extra Message before the optimistic row appears. That is not
  visible, but it shows in DevTools.
- **Stale re-reads are ignored.** Each re-read carries a sequence number, so an
  older snapshot cannot overwrite a newer one. Solid's `refresh` handles this
  internally.

## effect

```
effect/src
├── entry.ts, services.ts   ApplicationLayer = EventLog + SearchConfig + CheckoutStore
├── api.ts                  the Effect programs from api.ts, on Effect 4
├── eventLog.ts             EventLog Service (PubSub) and Layer (port of log.ts)
├── application.ts          root Block: tabs, three Bindings, crash view
├── typeahead.ts            Typeahead Block: interruptible SearchPackages
├── checkout/               Checkout Block
│   ├── definition.ts       Saga state machine (Idle | Running | Compensating)
│   ├── command.ts          step and compensation Commands
│   ├── update.ts           the saga coordinator
│   ├── view.ts, block.ts, index.ts
│   └── story.test.ts
├── logPanel.ts             LogPanel Block: Subscription on EventLog
├── typeahead.story.test.ts, logPanel.story.test.ts, scene.test.ts
├── fibers.test.ts          the real handlers, run on a TestClock
└── app.css                 the original's CSS, unchanged
```

There is no integration file. The original's `solid-effect.ts` (`runEffect`,
`effectAction`, and a runtime on context) has no counterpart, because Commands
already are Effects that the Runtime runs and interrupts.

**Typeahead.** Each keystroke returns `SearchPackages` for the new query and
`SearchPackages.Interrupt` for the search in flight. Each search has its own
interrupt key (its `searchId`), so the new one starts immediately rather than
waiting for its own cancellation. The interrupted fiber runs `searchPackages`'s
`onInterrupt` finalizer, which writes the `interrupt` entry to the log.
Results are `AsyncData`: `Refreshing` keeps the previous list on screen with
`.stale`, a failure after retries shows the error box with "Try again", and
late results are discarded by `searchId`. Retry ×3 with exponential backoff, the
4 s timeout and ~35% transient failures are the original program, ported to
Effect 4.

**Checkout saga.** Each step (reserve, charge, create order) is its own
interruptible Command, as each `yield*` is its own fiber in the original.
`update` is the coordinator. Cancel returns `<CurrentStep>.Interrupt`, and the
step's finalizer does the in-step cleanup ("voiding card authorization"). When
the Interrupt completes, or when the card is declined, update queues the
compensations for what actually committed, in reverse order (refund, then
release), and runs them one at a time. A step that finishes before its
Interrupt lands is recorded and compensated too.

**Event log.** Programs log through the `EventLog` Service. LogPanel's
Subscription maps its stream to Messages, so every fiber event is also a
DevTools entry.

Checked in the browser: typing "solid" quickly logs start/interrupt pairs for
s, so, sol and soli, then success; extending a query shows `.results.stale`;
Cancel during the charge logs the voided authorization and the hold release
and shows the cancelled notice; the decline path releases the hold and shows
the decline notice; a successful order appears in "Your orders".

### Parity gaps (effect)

- **Tabs keep their state.** The original unmounts the hidden tab, which
  resets it and, for the typeahead, interrupts an in-flight search. Here both
  Models are retained, which is Foldkit's documented pattern for navigation.
- **Compensation cannot be cancelled.** The Cancel button is disabled while
  compensations run. In the original, Cancel during compensation would
  interrupt the compensation step itself.
- **The notice clears when a checkout starts**, rather than when the action's
  transition commits.
- **Typing after an error starts a new search**, where the original's
  `<Errored>` boundary waits for "Try again". The error text names the failure
  (`TransientNetwork …` or `TimeoutError …`) instead of `String(cause)`.
- **Log times** are measured from when the EventLog Layer is built, not from
  module load.

## hackernews

```
hackernews/src
├── entry.ts, services.ts   ApplicationLayer = HnApi over Foldkit's Http.layer
├── hnApi.ts                HnApi Service: node-hnapi, Firebase users, retry
├── types.ts                response Schemas (recursive comments)
├── route.ts                typed bidirectional routes and href builders
├── query.ts                three KeyedQuery Blocks: Stories, Story, User
├── definition.ts, composition.ts   root Model, Messages, Query Bindings
├── subscription.ts         hover and focus intent → preload
├── command.ts              navigation and scroll Commands
├── update.ts               route-driven loading, shown-route derivation
├── view.ts                 nav, story rows, item, comments, user (render helpers)
├── block.ts
├── story.test.ts, scene.test.ts
└── app.css                 the original's CSS, unchanged
public/story-30186326.json  the original's 1,406-comment capture, unchanged
```

**Routing.** `/`, `/:type` (top | new | show | ask | job, with `?page=N`),
`/stories/:id` and `/users/:id` are `Route` biparsers. The same routers
parse URLs and build every internal href.

**Data.** Each resource is a KeyedQuery, a viewless Block bound to the root,
keyed by feed and page, story id, or user id. Entering a route calls
`requestLoadIfMissing` through its Binding. The Query dedupes in-flight
requests, ignores late responses and keeps each entry for the session.

**Preload.** A Subscription listens for `mouseover` and `focusin` on the
document (one delegated listener, like `intentPreload`). It maps the link
under the pointer to a route and dispatches `ShowedLinkIntent`, which runs the
same `requestLoadIfMissing`.

**Keeping the page up.** The Model keeps the route being replaced. Until the
new route's data settles, the view renders the previous page, so navigation
never flashes "Loading..." except on a cold start.

**Comments.** The same `<details class="toggle">` markup. The open state is in
the Model, and the summary click becomes a Message.

**Fetching from the browser.** `node-hnapi.herokuapp.com` sends
`Access-Control-Allow-Origin: *`, and the Firebase user API echoes the Origin,
so plain GETs work. Foldkit's `Http.layer` disables Effect's trace headers,
which would otherwise turn these requests into CORS preflights. During this
work node-hnapi answered **HTTP 503 (Heroku "Application Error")** once and
recovered minutes later. The HnApi Layer retries network errors and 5xx twice
with backoff, and a persistent failure renders "Could not load this page." with
"Try again". The original's `User-Agent: chrome` header is dropped, because
browsers will not set it.

Checked in the browser: cold start shows `Loading...`, then 30 stories;
hovering "more >" fetches `/news?page=2` before the click, and the click shows
page 2 immediately; a navigation that was not preloaded keeps the old page on
screen; comment collapse and expand work; the user page works; back
navigation does not refetch; the 1,406-comment capture renders 1,406 comments
(about 230 ms including the 626 kB fetch in dev), and a collapse takes about
65 ms.

### Parity gaps (hackernews)

- **Client-rendered only.** The original is the SSR and hydration baseline: no
  requests at boot, data serialized into the page, server functions. Foldkit
  has server rendering, but it has no server-function layer, and the brief asks
  for a client-rendered SPA. First paint here waits for JavaScript and the
  first fetch.
- **Cache policy.** Entries are kept until reload, and revisiting a page shows
  the retained data without revalidating. Solid's router `query` has its own
  short-lived cache and revalidation rules.
- **Scrolling.** The page scrolls to the top when a link is clicked, not after
  the next page has rendered.
- **Ask and text posts.** node-hnapi gives these a relative `item?id=…` URL,
  which the original renders as a broken external link. Here they link to
  `/stories/:id`.
- **Missing fields.** Absent fields are handled: null points or users on jobs,
  and the user and content missing on some deleted comments. An unknown user
  shows "User not found." where the original would throw.
- **The comment open state is in the Model,** so it survives navigating away
  and back. The original's native `<details>` state resets on remount.
- **Not-found and error UI** ("Page not found.", "Could not load this
  page. … Try again") are new; the original has neither.
- **"Created"** shows the raw Unix timestamp, as in the original. The nav link
  reads "Built with Foldkit".
