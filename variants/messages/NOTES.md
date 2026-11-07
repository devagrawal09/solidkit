# NOTES · messages variant

## Results

| | typecheck | tests | build JS raw / gzip |
| --- | --- | --- | --- |
| core | ✓ | 11 | n/a |
| todos | ✓ | 17 | 98.10 kB / 36.29 kB |
| effect | ✓ | 15 | 246.57 kB / 84.54 kB |
| hackernews | ✓ | 12 | 87.11 kB / 32.20 kB |

For comparison, the originals' last builds (from their `.turbo/turbo-build.log` in the
Solid repo, not rebuilt here): todos 86.65 / 31.81 kB, effect 234.32 / 79.29 kB. So
kernel + devtools + this core cost about 11.5 to 12 kB raw and 4.5 to 5.3 kB gzip.
hackernews-spa is an SSR app (its client chunks total about 216 / 76 kB, including
the router, hydration and the server-function client), so its numbers are not
comparable. This port is client-only, has no router, and keeps the 626 kB capture
out of the bundle (`public/story-30186326.json`).

## Line counts

`wc -l` of `src` (no tests, CSS or JSON). "code" drops blank and comment-only
lines. Foldkit numbers are from `../../foldkit-examples/NOTES.md`, which
formats at 80 columns; these use 100 to 120.

| | Solid original | Foldkit port | messages | messages, code | original, code |
| --- | --- | --- | --- | --- | --- |
| todos | 417 (5 files) | 1,286 (14) | 409 (4) | 347 | 339 |
| effect | 876 (7) | 1,844 (13) | 991 (7) | 757 | 671 |
| hackernews | 395 (10) | 1,071 (13) | 464 (9) | 402 | 330 |
| core library | n/a | n/a | 544 (3) | 398 | n/a |

- effect breakdown: `api.ts` 256 (unchanged), `solid-effect.ts` 182 (original 160 + a
  22-line helper), `log.ts` 32, `services.ts` 45, `app.ts` 199, `view.tsx` 257, `main.tsx` 20.
- core: `index.ts` 353 (variants, createProgram, subscription helpers), `testing.ts`
  155 (story, steps, scenario), `program.tsx` 36 (the component, the inert view).
- Test code: core 277 lines, todos 271, effect 325, hackernews 214.

## Tests

- core 11: 3 story-helper tests, 8 program tests. The program tests cover: commits
  and snapshots; a model write not held by its action; a success message landing
  with the refresh; failure and optimistic revert in the same frame (every
  observed frame is checked); rewind and replay with input dropped; an action
  settling while rewound having its message held until resume; keyed
  subscriptions; and a live kernel.
- todos 17: 8 story, 9 scenario through the rendered view. Scenarios: load; add;
  failed add stays and its retry succeeds; failed toggle; toggle-all and
  clear-completed fan-out; hash filter; time travel; error boundary Reset.
- effect 15: 5 story, 8 scenario, 2 live. Scenarios: supersede; stale-while-revalidate;
  give-up and Try again; saga success; decline with compensation; cancel with
  compensation; time travel; the fiber log rewinding. The live tests run the real
  fibers on Effect's TestClock: a superseded search is interrupted; a cancel
  during the charge step voids the charge, then releases the hold, in that order.
- hackernews 12: 1 routes, 3 story, 6 scenario, 2 fetcher. Scenarios: front page;
  held navigation; paging; back/forward from the cache; hover preload; time travel
  through kernel replay with the cache expired.

## What was easy

- **Update is the easy part.** The todos rules (first failure wins, bulk failures
  fan out, retry the same action, a failed add stays) are a switch plus one pure
  `retriesFor`. A failure record is the action to retry, as data, so retry is just
  `return model.failures[id]`.
- **Returning a message from a handler** (success) next to `onActionError` (failure)
  gave exact parity with the original's "error shown until a later save succeeds"
  without any status flags.
- **Story tests** are short and need no async. **Scenario tests through the real
  view** with the kernel's script mode passed almost entirely on the first run in all
  three examples. Rendering the real view is what keeps async data observed.
- **HN held navigation is free.** One async memo keyed on the route keeps the old page
  up. Routes as typed client state make clicks, back/forward and preload three small
  subscriptions. That suite passed on its first run.
- **Error boundaries needed nothing.** `<Errored>`'s reset re-ran a failed source
  created outside the boundary, in the program (todos load, typeahead give-up).

## What was hard (mostly Solid 2 timing, found by probes)

1. **An action owns its tick's flush.** `setModel(...)` then `action()` in one handler
   holds the model write until the action settles (a probe showed a cleared draft
   still showing for the whole save). The loop therefore starts requested actions
   in `onFlush`.
2. **`snapshot()` and held writes.** Outside actions, `snapshot()` sees pending
   writes, so commit-after-update is exact. Inside an action slice it shows a mixed
   view: new keys visible, changed keys not. Outside, a held write stays invisible
   until the transition lands. So messages sent from handlers commit in
   `onSettled`. The deferred commit's place relative to the refresh's `result` entry
   varies, and tests assert that part without order.
3. **When the model write and the optimistic revert land.** A plain store write made
   in an action becomes visible when the action returns. The optimistic overlay
   waits for a pending `refresh`. If a handler refreshed on its failure path, the
   failure would show next to the optimistic value for one round trip. Here a
   failure aborts the handler (no refresh: the save didn't happen), and a test
   checks that failure and revert arrive in one frame.
4. **Microtasks don't escape an action.** A fiber's first `log()` runs inside the saga
   step's slice. A `queueMicrotask` queued there runs before that slice's flush and
   joins the transaction, so every log line stayed hidden until the checkout
   settled (found by the live test). The log subscription uses `setTimeout`.
5. **The kernel's iterable wrapper breaks interruption** (details below). The read
   path uses `onCleanup` inside the service call instead.
6. **Unowned `onSettled` must return `undefined`.** An arrow that returned
   `push()`'s number threw `SETTLED_CLEANUP_UNOWNED`.
7. **Types.** Six generics on `ProgramSpec` don't infer through `satisfies`; an
   explicit annotation does. Story steps need `NoInfer` and a loosely typed
   `send(...msgs)` to mix variants. `createStore`'s `NoFn<T>` overload rejects a
   generic model, which needs one documented cast (`plain`). Core has 7 casts (the
   variants proxy, `plain`, two in `toList`, the erased handler map, an unused-Data
   default, optional flags), each with a comment. Examples and tests have no `as any` or `@ts-ignore`. The reused
   `solid-effect.ts` had `as any`; it now names the R = never cast.
8. **A flaky live test (fixed).** The first live cancel test waited for the notice,
   then asserted the log. The notice lands with the action's transition, in
   microtasks. The release's log entry reaches the model a task later, because
   fiber events are sent with `setTimeout` (item 4). A probe that sampled the state
   every task saw `notice=true released=false` in every run, so the 10 ms poll often
   read the log too early (verification saw 6 of 8 runs fail with "expected false
   to be true"). The api.ts checkout latencies are fixed, so they were not the
   cause. The other live test paused a fixed 15 ms between keystrokes against the
   real search latency (random 40 to 590 ms): it didn't fail in practice, but it
   depended on timing. Both now run on Effect's TestClock (`TestContext` in the
   `ManagedRuntime`), so the programs' sleeps end only when the test adjusts the
   clock. The tests wait on log entries, the notice or `TestClock.sleeps()`, and
   assert the whole ordered log. They take about 70 ms instead of 1.6 s.
9. **A test-only diagnostic.** Firing `input` and Enter in one tick tripped
   `UNCOMMITTED_INPUT_OVERWRITTEN` (the draft was never committed before it was
   cleared). Browsers run them as separate tasks, so the test helper flushes
   between them.

## Kernel changes I'd make

1. **`recordIterable` should forward `return()` immediately.** It is an `async
   function*`, and async generators queue `return()` behind a pending `next()`. A
   probe with a plain iterable: "open a, close a, open ab". Through
   `kernel.services`: "open a, open ab, land a, close a". The superseded source is
   closed only after it produces, so an Effect behind it is never interrupted.
   A hand-written iterator object fixes it.
2. **A way to commit when a transition lands.** `commit` snapshots now, but writes
   inside an action are invisible to `snapshot()` until the transition commits.
   Something like `kernel.commit(source, name, payload, { settled: true })` would
   help every variant. So would a documented "inside an action" check.
3. **Scripted `resolve`/`reject` should wait for the call**, like `expectCall`. Actions
   commonly start a flush after their trigger. This variant's `scenario` wraps them.
4. **Per-call cancellation.** Let `services` hand each call an `AbortSignal`, aborted
   when the reading computation's run is superseded, or by the action's interrupt.
   Keep it out of keys and logs. The saga here passes signals as arguments, and
   they log as `{}`.
5. **Hold, not drop, results while rewound.** `live()` is right for input. Action
   results that settle while rewound should be queued for resume; this core does
   that itself. A kernel-level queue would serve all variants.
6. **Devtools filters by source and name**, and grouping a message with the action and
   service calls it caused. `Logged`, `UpdatedDraft` and `IntendedLink` are honest
   but noisy.
7. **Replay misses are silent.** A never-recorded call returns a promise that never
   settles. That is right for "the page as it was mid-load", but it is easy to miss
   in the panel (notes are hidden by default).
