# @solidkit-tt/overlay: time travel as a read overlay

`goto()` writes nothing to the recorded sources. Every recorded getter, and the
recorded store's `state`, shows the recorded value while you travel and the live
value otherwise. The present keeps running underneath: writes, async landings
and refetches go to the live primitives and keep being recorded. `resume()` just
stops overlaying. Public Solid 2 APIs only (`solid-js` 2.0.0-rc.19).

`pnpm typecheck`: clean. `pnpm test`: 35/35 pass (11 spec scenarios, 12 probes,
8 experiments, 4 perf). No `test.fails`.

## How it works (`src/index.ts`)

**Timeline.**
- A cursor (`LIVE` or a step id).
- A log of closed steps, published through a `steps` signal.
- One history per recorded source: ascending step ids plus values. `valueAt(id)`
  is a binary search, falling back to the baseline.

**Recording.** This is the same as "commit". Each recorded primitive owns one effect over its
*committed* value and appends it to the open step:
- a signal's value;
- a plain copy of the store (see below);
- a memo's resolved value.

The first run sets or confirms the baseline, so it isn't a step. Equal values are
skipped. A step holds everything recorded in one tick. It closes on a microtask,
or early when a source records twice in the tick (a second synchronous
`flush()`). Recording continues while traveling, so steps keep arriving during
travel, numbered after the pre-travel latest step.

**Overlay.**
- **Signal.** `view = createMemo(() => cursor() === LIVE ? live() : valueAt(cursor()))`.
  The memo's equality means a reader only re-runs if its value actually differs
  between the present and the step.
- **Store.** `state = createProjection(() => cursor() === LIVE ? plain(live) :
  valueAt(cursor()), {}, { key: "id" })`. The projection's keyed reconcile
  notifies only the leaves that differ, and rows keep their proxies.
  - `plain(live)` is a **tree of memos**, one per object in the store. Each
    returns a plain copy of its object, with children taken from their own memos.
    A write recomputes only the memos on its path. Unchanged objects keep their
    copy, so consecutive steps share them and reconcile skips them by reference.
- **Memo.** A live memo, plus a view memo like the signal's.

**Cursor.** The cursor is co-written: a plain signal plus `createOptimistic(() => base())`.
`goto`/`resume` write both. A plain cursor write gets held when an action is
holding a write to a viewed source, because the view memo reads both. The
optimistic layer shows the move at once. `branch` writes only the plain one.

**Live lane.** A recorded memo's computation is registered (via `getObserver()`).
When a recorded getter is read *directly by it*, the getter returns the live
value, so travel doesn't feed the past into the present.

**branch().** This is the one place that writes. It truncates the log and the
histories, then writes the step's values into the live primitives through the
raw setters. Signals get `set(() => v)`. Stores get `reconcile(clone, "id")`,
falling back to positional when the root's own id differs. Memos re-derive.
The restore's echo is not recorded (structural check).

## Scenario results

| | Result | Notes |
|---|---|---|
| S1 one step per flush | **pass** | Two signals in one tick give one step `{a, b}`. A later write gives step 2. |
| S2 updater and equality | **pass** | `set(c => c + 1)` returns and records 1. `set(1)` and `set(v => v)` record nothing. |
| S3 goto/resume add no steps; memos and DOM follow | **pass** | Getter, plain memo and the rendered `<p>` show step 1, then the latest. Still 3 steps. |
| S4 stores restore fine-grained | **pass** | Row 1's effect: **0 re-runs** on goto(1) and resume. `state.rows[0]` keeps its identity. A probe shows the same at DOM level: `<For>` keeps the `<li>` nodes, and a removed row reappears only while traveling. |
| S5 writes during travel don't touch the past | **pass** | The view stays at 1. The write is recorded *during* travel as step 3 (3 steps while traveling) and visible after resume. |
| S6 held action writes recorded on commit | **pass** | No step while in flight. `{x: 5}` in one step after settle. |
| S7 one step per action, final value | **pass** | `{x: 2}` only. |
| S8 recorded async memo | **pass** | goto(1) and goto(0) show "B" and "A" with **0 fetchFn calls**. **resume() refetches nothing (0 calls)**: the live memo was kept current underneath. Live again afterwards ("D" becomes step 3). `q` is a plain signal here, as in the setter variant. |
| S9 result landing during travel | **pass** | The landing is recorded while traveling (step 3). The view stays at step 1, and resume shows 42. |
| S10 branch | **pass** | Steps truncated to `[1]`, live equals step 1, `traveling()` false, the next write is step 2. |
| S11 traveling flag and re-runs | **pass** | Flags `[false, true, false]`. A plain effect over both sources **re-ran 2 times** across goto(1) and resume (once per switch, only because values differed). |

## Probes beyond the spec (`test/probes.test.ts`)

Desired behavior, all passing:
- **goto writes nothing.** A recorded memo's live computation runs 0 times across
  goto(1), goto(0) and resume.
- **No leak into the past.** While traveling: a live signal write, a store write,
  and a query change that makes the live async memo refetch. Effects reading the
  view re-ran **0** times, `isPending` on the past is false, and all of it was
  recorded. **resume() takes one synchronous `flush()`**: no timers, no
  refetch, live values at once.
- **goto during a held action write** shows the past immediately and still shows
  it after the action settles. The action's write is recorded during travel.
- **A store write held by an action** (before and after a `yield`) is recorded
  once, with the final state.
- **branch from a store step.** No echo step, rows keep identity, the next write
  is step 2.
- **branch while an action holds a write.** The view never shows the abandoned
  present. `traveling()` stays true until the restore lands with the action.
  The restore wins, so the in-flight result is dropped without a step.
- **Live lane.** An async recorded memo over a *recorded* query doesn't refetch
  on goto/resume.

Limitations, asserted as observed:
- **A recorded memo reading a recorded STORE** sees the overlay. On goto it
  recomputes from the past and records it, and does so again on resume: steps 3
  `{m:10}` and 4 `{m:20}` are bogus. An async memo would refetch twice.
- **A plain memo between a recorded signal and a recorded memo** has one lane
  (the view), so it carries the past in: 2 bogus recomputes and steps.
- **HAZARD: a handler that reads a getter while traveling** writes a value derived
  from the past. At step 1 (2, present 3), `setX(x() * 10)` writes 20.
  Updaters (`setX(v => …)`) get the live value.
- **Back-to-back synchronous flushes of different sources** in one tick share a
  step. Same-source flushes are split.

## Experiments behind the design (`test/experiments.test.ts`, rc.19 behavior)

1. **A projection chained to the live store** (the derive returns the `live` proxy)
   is fine-grained while live. Switching it to a snapshot gives rows **new
   proxies** and re-runs effects with equal values, which fails S4. A projection
   over **plain** copies keeps rows and notifies only changed leaves.
2. **`deep()`/`snapshot()` are stale at the commit of a held transition.**
   Inside a computation, at that commit, they return the **pre-action** state
   (`{n:0}` instead of `{n:2}`). Proxy reads are current there, and so is
   `snapshot()` in an effect's *apply* phase. So a `deep(store)`-based recorder,
   which is the commit variant's spec, **records stale state after actions**, and
   a `deep()`-based view shows it. That is why the overlay builds its own plain
   copies.
3. **A plain cursor write is held** behind an action that holds a write to a
   viewed source: goto shows nothing until the action settles. A co-written
   optimistic cursor shows it at once and survives the settle.
4. **A bare `createOptimistic` write from a handler**, with no transition, is
   dropped.
5. **A root dispatch Proxy** over `state` (lane reads go to `live`) fixes the
   store-in-recorded-memo leak: 0 recomputes. But `deep(state)` then returns the
   proxy itself and tracks nothing, which silently breaks the canonical
   persistence effect. Not shipped.
6. **`onFlush` from an effect callback runs after the synchronous `flush()`**,
   batched with later ones in a microtask. Userland has no per-flush boundary, so
   steps group by microtask.

## Perf (`test/perf.test.ts`)

Setup: Apple M4 Pro, Node 24.18, vitest + happy-dom, **Solid dev build**. Writes
settle with a synchronous `flush()`. Numbers are warm runs, ranges over 4 runs.

| | plain Solid | overlay |
|---|---|---|
| 1. 10,000 writes to one signal, flush after each, no reader | 1.9 ms (0.19 µs/write) | 9.9–11.1 ms (**~1.0 µs/write**), 10,000 steps |
| … with one reader effect | 3.7–4.3 ms (0.39 µs/write) | 9.5–10.4 ms (~1.0 µs/write) |
| 2. 1,000 signals written in one tick (a reader each) | 0.27 ms | 1.0 ms, 1 step with 1,000 changes |
| 3. 1,000-row store (1,000 row effects), 200 one-row steps: record | 1.5–2.5 ms | **70–75 ms** (~0.36 ms/step) |
| 3. goto(1) | 0.29–0.35 ms (as `reconcile(step1)`) | **0.31–0.36 ms**, 199 row effects re-ran (exactly the rows that differ) |
| 3. resume() | 0.27–0.28 ms (as `reconcile(latest)`) | **0.31–0.46 ms**, 199 re-ran |
| read: 1M untracked signal reads | 13.7–14.8 ns/read | 21.5–23.1 ns/read (+~8 ns: a memo hop and the lane check) |
| read: 100k `state.rows[i].text` | 28.6–32.1 ms | 47.8–50.4 ms (~1.65×: a projection read) |

For the plain store, "goto"/"resume" are what plain Solid would pay to write a
recorded snapshot back (`reconcile`). The overlay's switch costs about the same,
because it is the same fine-grained notification, but it never touches the live
state.

Store recording, by method (200 steps × 1,000 rows):

| Method | Time | Fresh after held actions? |
|---|---|---|
| `deep(live)` alone | ~105 ms | no (stale, see experiment 2) |
| `deep` + an untracked proxy walk | ~490 ms | yes |
| memo tree | ~42 ms | yes |
| memo tree + projection + 1,000 effects | ~52 ms | yes |

The store's array memo tracks every row, so Solid prints `HUGE_FAN_IN` in dev
at 1,000 rows.

## Source size

`src/index.ts`: 325 lines, about 250 excluding comments and blank lines. Tests:
spec 369, probes 405, experiments 211, perf 221, plus helpers and a view.

## Answers to the questions

- **Show recorded values without writing anything?** Yes, for every recorded
  source. goto/resume write only the timeline's own cursor (two internal
  signals). The live primitives are untouched: a recorded memo's live
  computation runs 0 times across goto and resume. Only `branch()` writes, which
  it must, because it makes the past the present.
- **How is the store overlaid fine-grained?** With a projection whose derive
  returns a plain copy: the live one, or the recorded one. Keyed reconcile gives
  per-leaf notifications and stable row proxies. S4 holds: 0 re-runs of the
  untouched row, identity kept, DOM rows kept. Chaining the projection to the
  live proxy does not hold (experiment 1).
- **Cost per read?** About +8 ns per signal read (a memo instead of a signal).
  About 1.65× per store leaf read (a projection instead of a store). Writes cost
  ~1 µs vs ~0.2–0.4 µs for signals, and ~0.36 ms vs ~0.01 ms per store step at
  1,000 rows. Recording a store is O(array length) per change, mostly the array
  memo.
- **Does the present keep running? Is resume instant?** Yes for sources and for
  memos over recorded signals:
  - S5 and S9 are recorded during travel.
  - A live refetch happens during travel without touching the view.
  - Resume is one synchronous flush with no replay and no refetch (S8: 0 calls).

  No for derived state that reads recorded **stores** or goes through **plain
  memos**: that state has only one lane in userland, and it sees the past.
- **Leaks?**
  - Into the past: none found. Effects on the view never saw a live value while
    traveling (signal, store and async memo, plus a DOM list).
  - Into the present, there are three paths:
    - recorded memos reading recorded stores or plain memos, which produce bogus
      steps and refetches;
    - handlers that compute from getters while traveling;
    - `branch()` during a held action, which drops the action's result.

## What I'd change

- **Chunk the array memos** (e.g. 64 items per chunk) so a row change re-reads one
  chunk, not the whole array. That also removes `HUGE_FAN_IN`.
- **Ask Solid for:**
  - `snapshot()`/`deep()` that are correct at a held commit. That bug forces
    the memo tree, and it silently breaks `deep()`-based recorders (the commit
    variant).
  - A way to schedule work at the end of the *current* flush, for exact "one
    step per flush".
  - Above all, a real lane or fork, or a public read-through hook for stores, so
    derived computations can run on the present while the view shows the past.
    That is this design's only real gap.
- **For store-reading recorded memos:** either the root dispatch proxy (if
  `deep(state)` could be made to accept it), or pausing the memo while traveling.
  Pausing is untested; it trades the bogus steps for a recompute on resume.
- **Dev warnings:** warn on duplicate source names (the latest registration
  silently wins now). Warn when a recorded memo reads the store view, which is
  detectable with a dispatch proxy in dev only.
