# solid-kit · Slices variant

The lightest of the three variants. Client state lives in **slices**: one Solid
store per feature, changed only by **named, pure, synchronous mutations**
`(draft, ...args) => void`. Every call is committed to the kernel with its
name and JSON arguments, so the timeline reads like the code
(`todos · failed`, `nav · navigated`) and replaying the calls rebuilds client
state exactly. There are no message unions and no update function: the view
calls mutations and actions directly, so go-to-definition lands on the
behavior. Everything async stays in Solid (async memos, projections,
optimistic stores, actions, `Loading`/`isPending`).

## The API in one screen

```ts
import { slice, feature, replay } from "@solidkit/slices";
import { given, expectReplayable, scripted, settled } from "@solidkit/slices/testing";

// 1. Client state: a name, a typed initial state, named pure mutations.
const initial: TodosState = { filter: "all", errors: {} };
export const todosSlice = slice("todos", initial, {
  filterChanged(state, filter: Filter) { state.filter = filter; },
  failed(state, ids: string[], error: TodoError) { for (const id of ids) state.errors[id] ??= { ...error }; },
  saved(state, ids: string[]) { for (const id of ids) delete state.errors[id]; }
});

// 2. A feature: mounts slices, wraps services, builds data and actions.
export const Todos = feature((kit, api: Api, hash: string) => {
  const [state, { filterChanged, failed, saved }] = kit.use(todosSlice, { ...todosSlice.initial, filter: parseHash(hash) });
  const services = kit.services({ api });                    // recorded live, replayed when rewound, scripted in tests
  const server = createProjection(() => services.api.getTodos(), [], { key: "id" });
  kit.refreshable(server);                                    // re-derived when the timeline moves
  const addTodo = kit.action("addTodo", function* (todo: Todo) {  // a Solid action, recorded start/settled/failed
    setTodos(t => { t.push({ ...todo, pending: true }); });  // optimistic
    try { yield services.api.addTodo(todo); saved([todo.id]); }
    catch { failed([todo.id], { type: "addTodo", todo }); }  // a client fact, committed as "todos · failed"
    refresh(server);
  });
  return { state, filterChanged, addTodo /* … */ };
});

// 3. The view: <Todos.Context value={Todos.create(kernel, api, location.hash)}> … const { addTodo } = Todos.use();
//    and <Devtools kernel={kernel} /> beside it.

// 4. Tests: given(todosSlice) runs mutations on a plain object; Todos.create(createKernel({ script: true }), api, "")
//    plus scripted(kernel) runs the real feature against scripted services; expectReplayable(kernel) checks the timeline.
```

| Export | What it does |
| --- | --- |
| `slice(name, initial, mutations)` | A plain definition. Mutations get a draft and JSON arguments. |
| `feature(build)` | `{ create(kernel, ...deps), Context, use() }`. `build(kit, ...deps)` returns whatever the view needs. |
| `kit.use(slice, initial?)` | `[state, mutations]`: a store tracked by the kernel. Each mutation call is ignored while rewound (returns `false`), otherwise applied, committed as `slice · name(args)` and returns `true`. |
| `kit.action(name, function* …)` | A Solid `action`, recorded with `kernel.action`; resolves `undefined` without running while rewound. |
| `kit.recorded(name, fn)` | Same, for a promise-returning function built elsewhere (the Effect saga). |
| `kit.services`, `kit.refreshable`, `kit.kernel` | The kernel's, passed through. |
| `replay(kernel, upTo?)` | Client state rebuilt purely from the committed mutation calls. |
| `given(slice, initial?)` | Testing: `[state, mutations]` on a plain object, no Solid. |
| `expectReplayable(kernel)` | Testing: at every transition, the kernel's snapshot equals `replay()`. |

Core is 183 lines (`core/src/index.ts`, `core/src/testing.ts`), with 9 unit tests.

## The examples

Each example has `src/main.tsx` (creates the kernel, the feature, and mounts
`<App>` plus `<Devtools>`), a `state.ts` with its slices, one feature file
with data and actions, and the original's markup and CSS in the view files.

**todos** (`examples/todos`): `state.ts` has the `todos` slice (hash filter,
failed saves by id) and the pure `withErrors` list function. `todos.ts` keeps
the original's three layers: server truth (`createProjection` over
`api.getTodos`), errors from the slice applied on top (a derived
`createOptimisticStore`), and optimistic writes inside the five named actions.
Failures fan out per item, a failed add stays visible with its retry, and a
retry dispatches to the original action. `api.ts` and `app.css` are the
originals. The hash sets the filter, and the filter writes the hash back.

**effect** (`examples/effect`): `api.ts` (the fake Effect backend) and
`solid-effect.ts` (`runEffect`, `effectAction`) are the originals; the only
change to `solid-effect.ts` replaces an `as any` with a typed cast.
`backend.ts` turns each backend Effect into a Promise service that takes an
`AbortSignal` (aborting interrupts the backend fiber), and `call()` turns a
service call back into an interruptible Effect. `shop.ts` has four slices
(`shell` tab, `search` query, `checkout` cart/decline/notice, `log`
entries), the search memo (`runEffect(call(…))`), orders, and the saga as
`effectAction` recorded with `kit.recorded`. The checkout phase stays a
`createOptimistic` signal. `log.ts` is now the log slice; `api.ts` still
calls `log()`, which the feature points at the slice.

**hackernews** (`examples/hackernews`): `routes.ts` has typed routes
(`parse`/`href`), `state.ts` the `nav` slice (`navigated(route)`), and
`news.ts` the feature: one async `page` memo keyed on the route (Solid keeps
the current page on screen while the next loads) and `preload`. `hn.ts`
fetches from the browser (the same two endpoints as the original's
`server/hn.ts`, both send CORS headers) and keeps answers for a minute so a
hover preload serves the click. Story 30186326 is served from
`public/story-30186326.json` (626 KB, not bundled). `app.tsx` intercepts
same-origin link clicks, handles `popstate`, preloads on hover and focus, and
keeps the URL in step with the route. The components are the originals.

## Time travel

- All client state is in slices, mounted with `kit.use`, so the kernel tracks
  it. Every mutation call is a committed transition.
- **Each entry records the logical state.** Solid holds a store write that
  rides a pending transition (written in an action's first frame, or in the
  same frame as a navigation that suspends), and `snapshot()` outside that
  write's draft returns the committed value. A naive commit would record
  stale state. Each slice takes its snapshot inside the draft (where held
  writes are visible) and overwrites the kernel's snapshot for that entry.
  `expectReplayable` checks this in every scenario test.
- All I/O goes through `kit.services`, and the data sources are registered
  with `kit.refreshable`, so a rewind re-derives them from recorded answers.
  Tests assert `script.expectNoCalls()` while rewound.
- While rewound, mutations and actions are ignored and noted on the timeline
  (`ignored todos.filterChanged while time traveling`). Preloads are skipped.
  The URL follows the rewound route (hackernews) and filter (todos).
- What a rewound view does not show: optimistic overlays (pending marks, the
  checkout phase) belong to in-flight actions and are not client state, so
  they show as settled. Server data shows the last answer recorded at that
  point. An async result that lands while rewound (a save failing) is ignored
  like input, so its client fact is lost.

## Devtools

`<Devtools kernel={kernel} />` is mounted in every `main.tsx`. Entries read
as `todos · failed`, `action addTodo start`, `api.getTodos call`,
`replay hn.getStories call`, `backend.chargeCard error`. Click an entry to
see its payload and the state after it, rewind to it, resume, or export the
session. `window.__solidkit` exposes the same operations.

## Tests

`pnpm test` in each package. The test files are:

- Pure: `given(slice)` drives mutations on plain objects. Also
  `withErrors` (todos), routes (hackernews) and the log cap (effect).
- Scenarios: `Feature.create(createKernel({ script: true }), …)` inside
  `createRoot`, with `scripted(kernel)` resolving or rejecting each call.
  These cover optimistic updates and reverts, fan-out failures, retries, the
  held navigation, superseded flights (the stale search's `AbortSignal` is
  aborted), and saga success, decline and cancel.
- Time travel, one per example: rewind, assert the restored state and
  re-derived data, assert no pending calls, assert input is ignored, resume.
- Views: the real `App` rendered in happy-dom against scripted services.
  These cover loading, the error boundaries and their reset, the hash filter,
  link clicks, back, hover preload, and the URL following a rewind.
- effect also runs one test against the live Effect backend: a superseded
  search's fiber logs its interruption.

| Package | Tests |
| --- | --- |
| core | 9 |
| todos | 14 |
| effect | 13 |
| hackernews | 11 |

## Parity gaps against the originals

- **todos**: no differences in normal use that I found. Small differences:
  - The URL hash is rewritten when the filter changes through time travel.
  - The new-todo input is cleared even when the add is ignored while rewound.
  - "action … settled" on the timeline is when the generator finishes, before
    the refresh lands.
  - The error boundary's Reset re-asks the server but keeps the slice's
    errors. The original rebuilt `createTodos()` inside the boundary, which
    dropped them.
- **effect**:
  - The query, cart, decline toggle and notice now live in slices, so they
    survive tab switches; the original kept them in component signals that
    reset on remount.
  - Orders load at startup, not when the checkout tab first mounts.
  - The success notice can appear a moment before the refreshed orders. The
    original wrote `notice` in the saga's first frame, so it was held and
    landed with the orders. Doing that here would hold the decline checkbox
    for the whole saga.
  - Retry, backoff and timeout run inside the backend service call, so the
    timeline shows one call per search, not one per attempt (the log panel
    shows each attempt, as before).
  - Services take an `AbortSignal`, which the timeline shows as `{}`.
- **hackernews**:
  - Routing is the feature's own (typed routes in a slice, link
    interception, `popstate`), not `@solidjs/router` (installed, unused).
  - The original's `query` cache is replaced by a one-minute cache in `hn.ts`.
  - Preload dedupes repeated hovers of the same link only.
  - The `User-Agent` header is dropped (browsers forbid it).
  - Unknown paths render nothing, as in the original.
  - The first visit always fetches; there is no SSR or hydration.
