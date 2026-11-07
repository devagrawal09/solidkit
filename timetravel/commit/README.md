# @solidkit-tt/commit: record after each flush

The **commit** variant of userland time travel for Solid 2 (see `../SPEC.md`). It records only what
Solid has committed. Each recorded primitive has one effect that reads the committed value and
appends it to the step for the current flush. `goto` writes the past back through the raw
setters.

```
pnpm typecheck   # clean
pnpm test        # 3 files: 22 passed, 4 expected failures (S8, E3, E5, E12)
```

## How it works

**Recording** (`src/index.ts`)

- Each recorded primitive registers one `createEffect`:
  - a signal records `get()`;
  - a memo records its resolved value (a pending read holds the effect, so it never sees a promise);
  - a store is tracked with `deep(store)` in the compute phase and recorded as a `snapshot(store)`
    taken in the apply phase. `deep()`'s own snapshot is stale when an action's writes land (E12);
    see "Observations about Solid 2" below.
- The first recording in a flush opens a step and queues a microtask that publishes it. All
  effects of one flush run synchronously, so they share a step. That includes writes cascading
  from other effects in the same flush.
- A value equal to the source's latest record is skipped: `Object.is` for signals, structural
  equality (short-circuiting on shared branches) for stores and memos. Everything that commits
  while traveling is skipped.
- An async memo's first resolved value becomes its initial state (step 0), not a step.
- `steps()` reads a signal holding `{ list, n }` over an append-only array. Publishing is O(1),
  and the frozen array copy is made only when someone reads `steps()` after a change.

**Travel**

- `goto(id)`:
  - On the first goto, each source saves its *head*: the last value written through the wrapper
    for signals (so an uncommitted same-tick write survives, E6), or `snapshot(store)` for stores
    (this includes pending writes).
  - It then writes the recorded value at `id` back: signals through `set(() => v)`, stores
    through `setStore(d => reconcile(v, null)(d))` (positional; only differing leaves notify).
  - Recorded memos read a `view` signal and return their recorded value without calling `fn`.
- While traveling, the wrapped setters queue writes and return the value the write will produce
  after resume. Raw getters show the past.
- `resume()`:
  - Restores the saved heads, then applies the queued writes in order. Updaters re-run against
    the restored value (E7).
  - Runs in two phases. For one flush, recorded memos serve their *latest* record. Then they go
    live and re-run `fn`.
  - Without the second phase, a refetching async memo that the DOM reads would make Solid hold the
    whole resume until the fetch landed, including `traveling() === false` (seen in a probe of the
    first, single-phase version).
- `branch()`: keeps the viewed state, truncates the steps and each source's history to the viewed
  step, then applies the queued writes on top (E9).
- goto, resume and branch never call `flush()`, because `flush()` throws inside an action and is
  a no-op inside an effect callback. They are ordinary batched writes, visible after the next flush.

## Scenario results (`test/spec.test.ts`)

| | Result | Notes |
|---|---|---|
| S1 one step per flush | **pass** | Two writes in one tick → one step `{a, b}`; a later write → step 2. Caveats: E3, E4. |
| S2 updater and equality | **pass** | `set(c => c + 1)` returns and records 2; writing 2 again records nothing. |
| S3 goto and resume add no steps; memos and DOM follow | **pass** | Getter, a plain `createMemo` and the rendered DOM show step 1, then the latest; still 3 steps. |
| S4 stores restore fine-grained | **pass** | `goto(1)` restores row 2 only. The effect on row 1's text runs 2× before travel and 0× across goto + resume. Row 1's proxy identity is kept. |
| S5 writes during travel don't touch the past | **pass** | A timer write during travel is queued; the view stays at step 1; after resume it is step 4. |
| S6 writes held by an action are recorded when they commit | **pass** | Nothing is recorded in flight; one step `{n: 5}` at settle. |
| S7 one step per action, final value only | **pass** | Writes of 5, then 6 after the yield → one step `{n: 6}`. |
| S8 recorded async memo | **partial** (`test.fails`) | See below. |
| S9 a result landing during travel | **pass** | The action's post-await write is queued; the past is unchanged; after resume it is step 4. |
| S10 branch | **pass** | Steps after 1 dropped, live = step 1, `traveling()` false, the next write is step 2. |
| S11 traveling flag and effect re-runs | **pass** | `traveling()` goes false → true → false. A plain effect over two recorded signals re-ran **2×** across goto + resume (1 + 1). |

**S8 in detail.** The test follows the spec literally: a recorded query and a recorded async memo,
with nothing rendering the memo.

- What works:
  - Every committed result is recorded (`R(b)`, `R(c)`).
  - Travel never calls `fetchFn`.
  - After `resume()` the memo is live again.
  - It **refetches once** on resume (the memo must re-run `fn` to re-subscribe to its inputs). The
    refetched value equals the latest record, so no step is added.
- What fails: Solid commits the query write immediately and the result one fetch later, so
  per-flush recording makes them two steps: `[{q:"b"}, {result:"R(b)"}, {q:"c"}, {result:"R(c)"}]`.
  `goto(1)` therefore shows `("b", "R(a)")`. The app really did show that state (new query, stale
  result), but it is not "step 1's result".
- With a rendered reader (E1), Solid holds the query write until the result lands. Each query and
  its result then form one step, and every S8 expectation holds.

## Extra findings (`test/extra.test.ts`)

| | Result | What it shows |
|---|---|---|
| E1 S8 with a rendered reader | pass | Steps pair up as `{q, result}`. goto 1 and 0 make no fetches. `traveling()` is false right after resume, with no hold. 1 refetch on resume. A new query is recorded. |
| E2 S8 without a renderer | pass | goto 1/2/3/0 shows `(b,R(a)) (b,R(b)) (c,R(b)) (a,R(a))` with 0 fetches. Resume serves `R(c)` at once, refetches once, then goes live. |
| E3 two synchronous `flush()`es in one tick | **fail** | They merge into one step `{a: 3}`. The committed value 2 is never recorded: steps close on a microtask, and there is no public end-of-flush hook. |
| E4 effect cascade | pass | A write made by an effect in the same flush joins that step (`{a: 2, b: 200}`). Also, an effect's first-run write at mount is recorded as step 1. |
| E5 goto while an action holds a recorded write | **fail** | Solid holds goto's write to that signal together with the action, so after `goto(1)` it still shows 4. The past appears only when the action lands. No data is lost: resume restores and records the action's 5. |
| E6 same-tick write before goto | pass | A not-yet-committed signal and store write survives travel; it is recorded on resume. |
| E7 updaters queued during travel | pass | `set(c => c + 1)` returns 5 during travel and applies to the latest value (4 → 5); a queued store draft likewise. |
| E8 store restore semantics | pass | Positional reconcile removes later keys and rows, never mutates recorded snapshots, and an equal write records nothing. |
| E9 branch with queued writes | pass | Queued updaters apply to the branched state (2 × 10 → step 2 = 20). |
| E10 recorded sync memo | pass | During travel `fn` runs 0×; on resume it runs 1×. |
| E11 store write held by an action | pass | Recorded once at landing with the final contents. This needed the apply-phase `snapshot()`: with `deep()`'s value the step was silently dropped. |
| E12 (Solid) `deep()` at a transition landing | **fail** | At landing, the compute-phase `deep()` returned `rows [x, y1]` while the store and apply-phase `snapshot()` held `[x1, y1]`. The write made before the yield is missing. |

## Performance (`test/perf.test.ts`)

The per-write "settle" is `flush()`, one microtask turn (for the step publisher), then `flush()`.
Ranges are from 3 isolated runs of the perf file (Node, happy-dom, dev build). Under `pnpm test`,
with all files in parallel, perf 3 measured 232 / 1.6 / 3.8 ms.

| Measure | commit (recorded) | plain + 1 effect per source | plain, no readers |
|---|---|---|---|
| 1. 10,000 writes to one signal, settle after each | 9.2–14.6 ms (0.9–1.5 µs/write) | 4.4–4.6 ms (0.4–0.5 µs) | 2.8–3.2 ms (0.3 µs) |
| 1b. same, 1,000 writes with the spec's timer `settled(1)` | 1,141–1,159 ms | 1,144–1,165 ms | |
| 2. 1,000 signals written in one tick: settle + record | 0.9–1.0 ms (setup 1.3–1.9 ms) | 0.3 ms (setup 0.6 ms) | 0.1–0.2 ms (setup 0.2 ms) |
| 3. store, 1,000 rows, 200 one-row steps: record all | 166–171 ms | 109–116 ms (one `deep()` effect) | 0.9–1.0 ms |
| 3. `goto(1)` (+ flush) | 1.3–1.4 ms | 0.9–1.1 ms (reconcile to step 1) | 0.2 ms |
| 3. `resume()` (+ flush) | 1.3–1.4 ms | 0.9–1.2 ms (reconcile to latest) | 0.2–0.3 ms |

Reading the table:

- Recording a signal costs about 2× a plain signal with one effect. With timer settles, the
  overhead disappears behind timer latency.
- 1,000 recorders cost about 1 µs per source per batch and grow linearly. Setup is about 2× plain
  effects.
- Stores are the expensive case. Every write re-runs `deep()` over the whole store, which costs
  0.55 ms per step at 1,000 rows. The recorder adds a second snapshot and a structural compare, for
  about 0.84 ms per step: O(store size) per write.
- Solid's dev build warns `HUGE_FAN_IN` (2,004 sources) for that effect.
- goto and resume are about 1.4× a bare positional reconcile.

## Source size

`src/index.ts`: 310 lines (257 code, 34 comment, 19 blank). Tests: spec 313, extra 347, perf 196,
helpers 74, components.tsx 27.

## Answers to the questions

- **Exactly one step per flush, reliably (S1)?**
  - Yes for what one flush commits: same-tick writes (S1), an action's landing (S6, S7, E11), and
    effect cascades (E4).
  - No for several synchronous `flush()` calls in one tick: they merge, and intermediate commits
    are lost (E3).
  - "One step per flush" is not "one step per user change" once async is involved. Without a
    renderer, a query and its result are two steps (S8).
- **Do recorders see held action writes only when they commit (S6, S7)?**
  - Yes. Nothing is recorded in flight, and the final value is recorded once.
  - For stores, the effect re-runs at the right time, but `deep()`'s snapshot at that moment is
    wrong (E12), so the recorded value must come from `snapshot()` in the apply phase.
  - The same hold also swallows goto's writes to that source until the action lands (E5).
- **Cost of one effect per source (perf 2)?** About 1 µs per source per batched write and about
  1.5 ms of setup per 1,000 sources, roughly 2–3× a plain effect, and linear. Stores pay
  O(store size) per write instead (perf 3).
- **Recorded async memo (S8)?**
  - Records only resolved values and serves them during travel without fetching.
  - Refetches once on resume.
  - Steps pair inputs with results only when a renderer makes Solid hold the input write.
- **Do goto/resume avoid creating steps?** Yes (S3, S4, S11). Writes made during travel become
  exactly one step on resume (S5, S9, E7), and a same-tick write before goto is not lost (E6).

## Observations about Solid 2 (from probes while building this)

- An effect apply that returns a non-function (`v => log.push(v)`) halts the whole reactive
  system (`REACTIVITY_HALTED`). Recorders use block bodies.
- Setter updaters see the pending value, and the setter returns it (three `c => c + 1` in one tick
  give 4). The wrapper uses that return value as the head.
- An outside write to a signal that an in-flight action has written is held with that action.
  This is the cause of E5.
- When a render effect reads a pending async memo, Solid holds the write that made it pending
  (globally: other readers keep seeing the old input). When only user effects read it, nothing is
  held. This is the cause of the S8 vs E1 difference.
- `deep()` in an effect compute at a transition landing misses writes made before a `yield`
  (E12). A probe showed `push b; yield; push c` reading `["a"]` while the store held
  `["a","b","c"]`.
- `snapshot()` returns unowned subtrees by identity and copies owned ones on every call. Copies are
  immutable and the original initial object is never mutated. `reconcile(v, null)` keeps proxy
  identity and does not notify unchanged leaves.

## What I'd change

1. **Close steps at the real end of a flush.** This needs a public flush-end hook or a commit id
   readable from effects, and would fix E3.
2. **Make stores O(change) instead of O(store).**
   - Either use a cheap deep-change witness (a version node per store that `deep()` could expose
     without the walk and copy),
   - or record store writes as patches in the setter wrapper, and keep the effect only as the
     "this has committed" trigger.
3. **Report E12 upstream.** `deep()` returning stale data at a transition landing looks like a Solid
   bug. The apply-phase `snapshot()` workaround doubles the snapshot cost.
4. **Optionally keep a step open while a recorded memo is pending** (`isPending`), so an input and
   its result pair up without a renderer. The cost is that steps would no longer map to flushes.
5. **E5 can't be fixed by writing back:** Solid entangles the write with the hold. Viewing the past
   while an action holds a source needs the overlay approach (write nothing) or a real lane.
6. **Two smaller points:**
   - Resume refetches async memos. Avoiding that needs the memo's input dependencies, which
     userland can't see.
   - During travel, raw getters return the past, so `set(get() + 1)` in a handler computes from the
     past. Only the updater form is safe (E7).
