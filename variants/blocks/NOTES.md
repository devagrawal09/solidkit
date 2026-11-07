# Notes: the Blocks variant

Built against Solid 2.0.0-rc.19, TypeScript 6.0.3, Vitest 5 (happy-dom), Effect
3.22.4. Measurements are from this machine (Apple Silicon), 2026-10-29.

## Results

| | typecheck | tests | build | JS raw | JS gzip | `tsc` wall (3 runs) |
| --- | --- | --- | --- | --- | --- | --- |
| core | pass | 17 | n/a | n/a | n/a | 0.76 / 0.71 / 0.71 s |
| todos | pass | 16 | pass | 109.57 kB | 39.99 kB | 0.81 / 0.81 / 0.82 s |
| effect | pass | 15 | pass | 258.33 kB | 88.29 kB | 0.98 / 0.99 / 0.99 s |
| hackernews | pass | 13 | pass | 99.67 kB | 36.29 kB | 0.81 / 0.81 / 0.82 s |

Tests: todos 9 pure + 7 scenario; effect 6 pure + 8 scenario + 1 live (real
Effect programs); hackernews 5 pure + 8 scenario; core 17 (pure updates,
routing, operations, out-message folds, keyed disposal, assembly checks, actions
with in-transition failures, replay, drivers, prompt stream close, subscriptions,
and type-level checks with `@ts-expect-error`). Each example has a time-travel
test (rewind, check the screen and the restored state, assert no live calls).

The only dev warning left in the test output is todos'
`UNCOMMITTED_INPUT_OVERWRITTEN`, from the test that clicks a checkbox while
rewound (the click is ignored and Solid writes the bound value back). `vite
build` prints the TodoMVC CSS's `::input-placeholder` warning, as the original does.

### Bundle size against the originals

The originals' sizes come from their last recorded builds
(`examples/*/.turbo/turbo-build.log` in the Solid repo), not rebuilt here.

| | original JS (gzip) | Blocks JS (gzip) | difference |
| --- | --- | --- | --- |
| todos | 86.65 kB (31.81 kB) | 109.57 kB (39.99 kB) | +22.9 kB (+8.2 kB) |
| effect | 234.32 kB (79.29 kB) | 258.33 kB (88.29 kB) | +24.0 kB (+9.0 kB) |
| hackernews | SSR + hydration, split chunks (about 156 kB, 55 kB gzip with router) | 99.67 kB (36.29 kB), client only, no router | not comparable |

Roughly 23 kB raw (8 to 9 kB gzip) is the kernel, its devtools panel and this
core; the rest of the difference is example code.

### Type-check cost

`tsc -p tsconfig.json --extendedDiagnostics`, TypeScript 6.0.3 (JS compiler). The
Blocks numbers include the tests, the core and the kernel sources (workspace
packages are type-checked from source).

| | types | instantiations | check time | wall |
| --- | --- | --- | --- | --- |
| Solid original todos (TS 6.0.2) | 8,196 | 35,499 | 0.15 s | 0.41 s |
| Solid original effect | 11,885 | 43,086 | 0.22 s | 0.63 s |
| Solid original hackernews-spa | 23,207 | 35,053 | 0.23 s | 0.64 s |
| Blocks core (with its tests) | 10,444 | 31,641 | 0.22 s | 0.71 s |
| Blocks todos | 22,618 | 56,228 | 0.31 s | 0.81 s |
| Blocks effect | 22,275 | 57,750 | 0.32 s | 0.99 s |
| Blocks hackernews | 18,190 | 55,941 | 0.30 s | 0.81 s |
| Foldkit todos / effect / hackernews (their NOTES, TS 7 native) | 178k / 123k / 129k | 1.43 M / 0.83 M / 1.22 M | 0.13 to 0.15 s | 0.40 s (1.04 to 1.18 s on TS 6) |

No TS2589, no editor lag. The block types stay shallow because a block's public
type is only its type bag, its children record, its data and its operations; the
spec is `unknown` on the `Block` value, children are checked one level deep
(slot type and a contravariant services phantom), and requirement maps are flat,
written once per block and checked at each binding instead of being inferred up
the tree. About 20k extra instantiations per example over the original is the
price.

## Line counts

`wc -l` of `src` (no tests, no CSS, no JSON capture).

| | Solid original | Foldkit port | Blocks | Blocks tests |
| --- | --- | --- | --- | --- |
| todos | 417 | 1,286 | 461 | 258 |
| effect | 876 | 1,844 | 1,002 | 299 |
| hackernews | 395 | 1,071 | 578 | 220 |
| core library | | | 988 (826 index.ts + 162 testing.ts) | 552 |

effect includes `api.ts` and `solid-effect.ts` copied unchanged (416 lines); its
own code is 586 lines against the original's 460 outside those two files.
hackernews includes the copied `types.ts` (30). The Blocks ports are 1.1 to 1.5
times the originals, where the Foldkit ports are 2.1 to 3.1 times.

## What was easy

- **Async stayed in Solid with no flags.** Optimistic stores, `action`,
  `refresh`, `isPending`, `latest`, `<Loading>` and `<Errored>` did all the
  loading, failure and stale-while-revalidate work; blocks only own the facts.
  A failed save's fact (`SaveFailed`) applied inside the action lands in the same
  frame as the optimistic revert, so a failed add never flickers out.
- **Composition is small at the call site.** `children: { list: field(TodoList) }`
  plus an `out` fold replaced Solid's context and Foldkit's Definition,
  Composition and Binding objects. Bindings are checked: a child whose services the
  parent does not declare, a field of the wrong shape, a missing out policy (and,
  by the mapped type, a missing out-message handler) and an unlisted service key
  are type errors (core tests assert the first, second, third and last).
- **Keyed instances fit hackernews well.** One instance per visited page made
  its memo the page cache: preload is "open the instance", back/forward reuse
  it, an LRU removes old pages and disposal tears their data down. Keeping the
  current page up while the next loads needed nothing: the new page's view
  reads a pending memo and Solid holds the navigation.
- **Reusing `effectAction` unchanged.** `driven(effectAction, function* (act) {…})`
  lets another driver run a handler while the block still tracks its steps, maps
  its errors and exposes `interrupt`.
- **Pure tests are cheap.** `testUpdate` and `testOut` run any block's update or
  any parent's fold on a plain copy and report acts, out-messages and the child
  operations called.

## What was hard (and what it taught about Solid 2)

1. **Snapshots inside actions.** `snapshot(store)` taken inside an action does not
   reliably show the action's own writes (after a `yield` it showed the
   pre-action value even though the write had been made). A message applied inside
   an action (`onActionError`, `ctx.send`) must therefore be committed when the
   transition lands: the core calls `onSettled` from inside the action step, which
   fires after the landing. Knowing "we are inside an action step" needed a small
   generator wrapper that counts steps.
2. **Writes in the same tick as an action start are held by it.** Clearing the
   todo input and starting `addTodo` in one handler left the input full until the
   save settled. The dispatcher now applies a whole cycle of updates, calls
   `flush()`, then starts the actions (Elm's order). This is invisible in the
   originals because they write the DOM directly or never write client state next
   to an action.
3. **Prompt cancellation through the kernel.** The kernel records AsyncIterables
   with an async generator, whose `return()` waits for the pending `next()`. A
   superseded `runEffect` flight would therefore run to completion instead of being
   interrupted. `run()` now remembers each source iterator below the kernel and
   closes it directly when Solid closes the recorded one (core test, and a live
   effect test showing the fiber's interrupt finalizer).
4. **Progress inside a saga cannot be model state.** Model writes inside an action
   are held, so a "charging…" step indicator in the model would only appear when
   the saga ends. It stays a `createOptimistic` signal, which means it is not in
   time-travel snapshots. Likewise, fiber log entries emitted synchronously inside
   a saga step would be held: the EventLog subscription delivers them a task later.
5. **Test environment.** happy-dom creates no text node for `el.textContent = 0`,
   so Solid's next in-place update of a rendered `0` throws and halts reactivity
   for the rest of the file; `@solidkit/blocks/testing` patches the setter when it
   detects the bug. A scenario test that fails before disposing its app leaves its
   document listeners alive (they swallowed later tests' clicks); the HN tests
   dispose with `onTestFinished`.
6. **Typing the existential block.** `Block<any, …>` with typed spec functions broke
   on variance (`init(args: unknown)`), so the public `Block` carries its spec as
   `unknown` and its types through a phantom. The runtime reads specs loosely.
   Casts in core: `specOf` (the one structural cast), `driven`'s driver signature,
   `variants`' proxy, and `as never`/`as Loose` at the typed boundary of `run`,
   the update context and `createComponent`. Example code has none of its own
   beyond `response.json() as Promise<T>` at the HN fetch boundary; the two in
   `solid-effect.ts` (`as any`, `as never`) are the original file's.
7. **Rewinding before a response exists** shows that read as pending forever (the
   kernel notes "no recording"). It is faithful (the app was waiting then) but
   surprised me in a test; the assertion now distinguishes the click's entry from
   the entry where the response arrived.

## Kernel changes I would make

1. Record AsyncIterables with a hand-written iterator whose `return()` closes the
   source at once (the core works around this; see 3 above).
2. Return an unregister function from `refreshable()`. Keyed instances register
   sources and are later disposed; the kernel keeps them (refreshing a disposed
   memo is a harmless no-op, but the array only grows).
3. Commit at transition landing, or expose "inside an action" so a variant does
   not need its own step counter: `commit` inside a transition snapshots too early.
4. Record errors with `name` and own fields, not just `message`. Replayed errors
   come back as `Error(message)`, so `instanceof`, tags and `String(error)`
   differ from the live run (effect's error box text, Effect's tagged errors).
5. Script iterable-shaped services as iterables. In script mode every call
   returns a Promise, so interruption of a superseded stream cannot be tested
   with scripted services (the effect example needs a live test for it).
6. Rate-limit `live()` notes per source: a subscription firing while rewound (the
   fiber log) floods the timeline with "ignored …" notes.
7. Devtools: filter and group by `source` (block path), and show a block's slice
   of `stateAt`, which this variant's paths make easy.

## What I would change in this core

- Messages to a block from inside an action land at the end of the action. That is
  Solid's semantics, but nothing tells the author; a dev warning when a message
  sent from inside an action only changes fields the view reads would help.
- Every keystroke and every fiber log entry is a transition. A per-block
  `coalesce` option (merge consecutive `ChangedText` entries in the timeline) would
  keep devtools readable.
- `out` folds and operations each commit their own entry. That makes the chain
  readable (`todos/header · Submitted`, `todos · header.EnteredTitle`,
  `todos/list · RequestedAdd`) but triples the entries per cross-block action.
- The keyed view reads its `key` once; it should be rendered under a keyed
  `<Match>`, `<Show keyed>` or `<For>` (hackernews does). An accessor-aware
  version would remove that rule.
