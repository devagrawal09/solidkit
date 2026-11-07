# @solidkit-tt/setter: record at setter time

One of three userland time-travel variants for Solid 2 (2.0.0-rc.19), built to
`../SPEC.md`. This one records a write when its setter is called, groups one
tick's writes into one step, and travels by writing past values back through
the raw setters.

`pnpm typecheck` passes. `pnpm test` gives 17 passed and 2 expected failures
(19 tests: 9 scenarios pass, S6 and S7 are marked `test.fails`, plus 7
findings tests and the perf test).

## How it works

- **Recording.** Each wrapped setter calls the raw Solid setter and passes the
  value it returns to the timeline:
  - signals: the new value, so an updater records its computed value (Solid
    runs the updater against the pending value);
  - stores: `snapshot(draft)`, taken inside the raw setter right after the
    user's draft function. That is the only place that also sees writes an
    action holds.
  - A write equal to the latest recorded value records nothing. Signals use
    `Object.is`; stores use a structural compare that short-circuits on shared
    branches.
- **Async memos.** `createRecordedMemo` has no setter, so its "setter" is the
  moment a value is produced: a sync result right away, a promise when it
  resolves. Only the latest run counts, and the first value is the memo's
  initial state.
- **One step per tick.** The first recorded write of a tick opens a step and
  queues `queueMicrotask(close)`. The raw setter has already run by then, so
  Solid's own flush microtask is queued ahead of ours: the step closes right
  after the flush it describes. A recorded sync memo recomputes inside that
  flush and lands in the same step (findings F7). If a source ends the tick back
  at the value it started with, it is dropped from the step. An empty step is
  discarded.
- **Publishing.** Closing a step appends it to an internal log and writes a
  small signal `{ log, n }`. `steps()` returns a frozen copy, made once per
  published version. A write therefore costs O(1). The first version copied
  the whole list on every step; that made 10,000 writes 6 to 8 times slower.
- **goto(id).** It closes the open step, computes the state after step `id`
  (the latest change per source at or before `id`, else the initial value),
  and writes every source whose value differs through its raw setter:
  - signals: `rawSet(() => v)`;
  - stores: `reconcile(v, null)(draft)`. The positional reconcile keeps
    unchanged proxies and notifies only changed leaves. A keyed reconcile
    throws when an object's id changes.
  - memos: an overlay signal. While it is set, the memo returns the recorded
    value and never calls its function.

  None of these writes go through `record()`, so traveling adds no steps.
- **Writes while traveling** are queued. A signal updater is computed at once
  against the live value (latest plus earlier queued writes), so the setter
  returns the right value and the updater runs once. A store draft function is
  queued as it is.
- **resume()** writes the latest values back, clears `traveling`, and replays
  the queue through the wrapped setters, so queued writes become one new step.
  One microtask later the memos leave their overlay. They show the recorded
  latest value while their function runs again, instead of the step you were
  viewing.
- **branch()** truncates the log at the viewed step and makes that state the
  latest. It drops queued writes, because they were made against the future
  being discarded, and lets the memos go live.

## Results

| Scenario | Result | Notes |
| --- | --- | --- |
| S1 one step per flush | pass | `{ a: 1, b: "y" }` as one step, then `{ a: 2 }`. |
| S2 updater and equality | pass | `set(c => c + 1)` records (and returns) 2. `set(2)` and `set(c => c)` record nothing. |
| S3 goto and resume add no steps; memos and DOM follow | pass | A plain `createMemo` and a JSX component rendered with `render` (happy-dom) follow `goto(1)` and `resume()`. `steps().length` stays 3. |
| S4 stores restore fine-grained | pass | `goto(1)` restores row 2. The effect on row 1's text re-runs 0 times (on `goto` and on `resume`), and `store.rows[0]` keeps its identity. |
| S5 writes during travel don't touch the past | pass | A timer's `setX(c => c * 10)` while viewing step 1 leaves x at 2. It is computed against the live 3, queued, and recorded on `resume()` as step 3 (`x: 30`). |
| S6 writes held by an action are recorded when they commit | **fail** (`test.fails`), partial | Step `{ x: 5 }` is in `steps()` while `x()` is still 0 and the action is in flight. After the action settles, the steps are exactly as the test expects (F1). Right step, recorded about 20 ms early. |
| S7 one step per action, final value only | **fail** (`test.fails`) | Records `[{ x: 1 }, { x: 2 }]`, one step per tick of the action. x = 1 never committed (the effect sees 0, then 2), yet `goto(1)` shows it (F2). |
| S8 recorded async memo | pass | Steps `[{ result: "B" }, { result: "C" }]`. `goto(1)` shows B and `goto(0)` shows A, with no `fetchFn` call. **`resume()` refetches once** (1 call). The memo shows C during the refetch and records no step, since the result is equal. A new query then records step 3 (`D`). |
| S9 a result landing during travel | pass | The write after the `await` happens while traveling, so it is queued and the viewed past is unchanged. `resume()` applies it and records step 3 (`x: 42`). |
| S10 branch | pass | Steps after 1 are dropped, x = 2, `traveling()` is false, and a new write records step 2. |
| S11 traveling flag and effect re-runs | pass | `traveling()` goes false, true, false. **A plain effect over a recorded signal and a recorded store re-ran 2 times across one goto + resume** (once for each move). |

### Extra findings (`test/findings.test.ts`)

These tests pin down what the variant actually does, so a change in Solid or
in the variant shows up.

- **F1.** S6 without the in-flight check: the step is recorded at call time,
  with the value that later commits.
- **F2.** After S7, `goto(1)` shows x = 1, a state the app never displayed.
- **F3. A `goto()` during an action that holds a recorded write is itself
  held.** Restoring that source joins the action's transition. Everything else
  `goto` wrote in the same frame is held with it: the other sources and the
  `traveling` flag. While the action runs the app shows `[x 0, y "b",
  traveling false]`; only when it settles does the view become step 0. The
  restore also overwrites the held x = 5 inside the transition. `resume()`
  puts it back. Any design that travels through raw setters has this problem.
- **F4.** Whether `steps()` shows S6's early step depends on its readers. An
  effect that reads `steps()` next to the held source (a devtools panel showing
  both) pulls the timeline's own signal into the action's hold. `steps()` then
  stays empty until the action settles, and S6's in-flight check would pass by
  accident.
- **F5.** A recorded query and the async memo it feeds land in separate steps,
  `{ q: "b" }` then `{ result: "B" }`. Solid commits q at once and keeps the
  old result while the new one loads, so `goto(1)` shows the loading state
  (q = b, result = A). That is faithful to the screen, but one user action
  becomes two steps.
- **F6.** For an unrelated write made while an action is in flight, both writes
  are recorded at call time. The steps follow call order (x is step 1, y step
  2), although y committed about 16 ms before x.
- **F7.** A recorded sync memo lands in the same step as the write that
  changed it (`{ n: 2, double: 4 }`).

## Answers to the questions

1. **Does recording at setter time produce correct steps given Solid's
   batching?** For plain writes, yes. Solid applies one tick's writes in one
   flush, and a step closed by a microtask queued after the first write covers
   exactly that flush (S1, S2, S5, S10, F7). It goes wrong wherever Solid
   separates "called" from "committed": writes inside actions (S6, S7, F6), and
   a goto that writes into a held transition (F3).
2. **How is a tick's writes grouped into one step?** The first recorded write
   opens a step and queues `queueMicrotask(close)` (details under "One step per
   tick" above).
3. **What happens to writes held by an action?** They are recorded too early:
   at call time, while Solid still shows the old value. For a single write the
   recorded value is the one that later commits (F1). The step exists before
   the commit, and its place in the timeline is call order, not commit order
   (F6). With writes on both sides of a `yield`, the earlier value is recorded
   as a step of its own although it never committed, and `goto` can show it
   (S7, F2).
4. **Does goto/resume avoid creating steps?** Yes. They write through raw
   setters and memo overlays and never call `record()`. `resume()` records only
   the writes queued during travel (S5, S9), which is intended. An async
   recorded memo refetches once on `resume()` and on `branch()`. An equal
   result adds no step. The memo has to run its function again to track its
   dependencies.
5. **What does a write cost?** See the table below.
   - A signal costs about +0.7 µs per write, about twice a plain write settled
     the same way.
   - 1,000 signals written in one tick cost +0.5 to 1.3 ms.
   - A store costs O(rows): about +330 µs per write at 1,000 rows. Most of that
     is `snapshot(draft)`, about 240 µs once 200 rows have been modified,
     because it copies every modified row on every write. The structural
     compare adds the rest.

## Performance

`test/perf.test.ts`, Apple Silicon, happy-dom, Solid's dev build. Each figure is
the median of 5 runs (3 for 1b), from the `pnpm test` run. The figures in
parentheses come from a second run of the perf file alone.

"Settling" a write means `flush()` plus one awaited microtask. That is when
this variant closes its step. With timer settling (row 1b) a write costs
about 1.15 ms whatever the variant, because `setTimeout` dominates.

| | plain Solid | setter | difference |
| --- | --- | --- | --- |
| 1. 10,000 writes to one signal, settle after each | 6.72 ms, 0.67 µs/write (6.47) | 13.46 ms, 1.35 µs/write (13.09) | +0.7 µs/write |
| 1b. 1,000 writes, `settled(1)` after each | 1,150 µs/write | 1,145 µs/write | none measurable |
| 2. 1,000 signals written in one tick: settle + record | 0.08 ms (0.30) | 0.63 ms (1.60) | +0.5 to 1.3 ms; creating them: 0.26 vs 0.34 ms |
| 3a. store of 1,000 rows, 200 one-row steps: record all | 2.73 ms, 14 µs/step (4.69) | 67.98 ms, 340 µs/step (80.93) | about 24 times |
| 3b. `goto(1)` + flush (199 row effects re-run) | 0.83 ms (1.33) | 0.54 ms (0.50) | |
| 3c. `resume()` + flush | 0.73 ms (0.97) | 0.39 ms (0.39) | |

- For 3b and 3c, the baseline reconciles by hand a snapshot the test took
  itself: `setStore(d => reconcile(snap, null)(d))`.
- The variant's goto and resume were faster than that baseline in both runs.
  I didn't investigate why; both are under 1.5 ms.
- In the store test, every one of the 1,000 rows has its own effect.

## Size

- `src/index.ts`: 272 lines, 231 without blank and comment lines.
- Tests: `spec.test.ts` 352, `findings.test.ts` 194, `perf.test.ts` 137,
  `helpers.ts` 25, `view.tsx` 10.
- `experiments/close-on-settle.diff`: 42 lines (see below).

## Limitations

- A store setter takes draft mutations only, as in the spec's type. A
  replacement value returned from the draft function (Solid's `filter` idiom)
  is ignored.
- Signal values are recorded by reference. Mutating an object after setting it
  changes history (Solid has the same rule).
- Names must be unique per timeline. Registering a name again replaces the
  source. Sources are never unregistered on dispose.
- `branch()` drops writes queued while traveling.
- A memo's first value is its initial state, so `goto` into steps recorded
  before that value existed shows it.

## What I'd change

1. **Land steps when Solid says the write settled, not at the microtask.**
   `experiments/close-on-settle.diff` adds 11 lines and removes 7, mostly
   moving the old `record` body into a `land` function. Apply it with
   `patch -p1 < experiments/close-on-settle.diff`. Each wrapped setter call
   then registers `onSettled(() => land(name, value))`.
   - Solid fires the callback after the write's own transition settles: right
     after the flush for a plain write, when the action finishes for a write
     inside one. Writes that land in the same flush share a step. Values are
     still the setters' return values.
   - I ran it against the same tests. **All 11 scenarios pass**: S6 has
     nothing in flight and then `{ x: 5 }`, and S7 has one step `{ x: 2 }`.
   - An unrelated write during an action gets its own step, in commit order:
     `[{ y: 1 }, { x: 5 }]`.
   - The cost is about the same: 6 to 7 ms for 10,000 writes, against 5.7 ms
     in the same microbenchmark.
   - It has a new hole. A held write now lands while you are traveling, so it
     changes the viewed past (x = 5 appears while viewing step 0). And
     `land()` ignores writes while traveling, so the timeline loses a write
     that did commit.
   - Fixing that means recording the landing into the latest state and
     re-pinning the viewed value. At that point the design is "commit time,
     with setter values". It still couldn't merge a query with its async
     result (F5): q's `onSettled` fires before the result arrives.
2. **Don't restore through raw setters while an action holds one of them**
   (F3). Either make `goto` wait visibly for the transition, or overlay the
   view instead of writing it, as the overlay variant does.
3. **Stores.** A snapshot per write is the dominant cost. Diffing recorded
   paths would need Solid to report what a draft touched. Snapshotting once per
   tick would only help bursts, and outside the setter a snapshot can't see
   held writes.
4. **Async memo refetch on resume.** It is inherent while the overlay stops the
   memo's function. A small cache keyed by the memo's inputs, or keeping the
   live memo running under the overlay, would avoid it.

## Files

- `src/index.ts`: the variant.
- `test/spec.test.ts`: S1 to S11.
- `test/findings.test.ts`: F1 to F7.
- `test/perf.test.ts`: the perf protocol.
- `test/helpers.ts`: `settled`, `delay`, `waitFor`.
- `test/view.tsx`: the S3 component.
