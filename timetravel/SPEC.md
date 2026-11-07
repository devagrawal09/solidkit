# Userland time travel for Solid 2 — shared spec

Three variants implement the SAME API and the SAME test scenarios, so results compare directly.
Everything stays in userland: public Solid 2 APIs only (no core changes, no internal exports such
as `clock`, no `DEV` hooks).

## API (every variant exports exactly this from `src/index.ts`)

```ts
export type Step = { id: number; changes: Record<string, unknown> }; // committed values per source name

export interface Timeline {
  steps(): readonly Step[];   // reactive; excludes the initial state
  goto(id: number): void;     // view the state right after step `id` (0 = the initial state)
  resume(): void;             // back to the latest state
  branch(): void;             // continue live from the viewed step, dropping later steps
  traveling(): boolean;       // reactive; true between goto and resume/branch
}

export function createTimeline(): Timeline;
export function createRecordedSignal<T>(
  initial: T,
  options: { name: string; timeline: Timeline }
): [get: () => T, set: (value: T | ((prev: T) => T)) => T];
export function createRecordedStore<T extends object>(
  initial: T,
  options: { name: string; timeline: Timeline }
): [state: T, setState: (fn: (draft: T) => void) => void];
export function createRecordedMemo<T>(
  fn: () => T | Promise<T>,
  options: { name: string; timeline: Timeline }
): () => T;
```

## The variants

- **setter** — record when the setter is called, using the value the setter returns; group writes
  made in the same tick into one step (microtask). goto writes past values back through the raw
  setters; while traveling, wrapped setters queue writes and resume applies them.
- **commit** — record after each flush: every recorded primitive registers an effect that reads the
  committed value (signal value, `deep(store)` snapshot, a memo's resolved value) and appends it to
  the current step, skipping while traveling and skipping values equal to the latest recorded one.
  goto writes past values back through raw setters; writes while traveling are queued for resume.
- **overlay** — record after each flush (as in commit), but goto writes NOTHING: each recorded
  getter (and the store view) shows the recorded value while traveling and the live value
  otherwise, so the present keeps running underneath (a userland emulation of a "lane"). Writes
  during travel go to the live state; resume just stops overlaying.

## Scenarios (implement each as a vitest test in `test/spec.test.ts`, with these exact names)

Use one helper `settled()` = a few rounds of `await new Promise(r => setTimeout(r, 0)); flush();`.
Test the DESIRED behavior below even when your design can't meet it: a failing scenario is a
result. Never weaken an assertion to make it pass; mark known failures with `test.fails` only
after you are sure, and explain why in the README.

- **S1 one step per flush** — two writes to two recorded signals in one tick produce exactly one
  step listing both committed values; a later write produces a second step.
- **S2 updater and equality** — `set(c => c + 1)` records the computed value; writing an equal
  value records nothing.
- **S3 goto and resume add no steps; memos and DOM follow** — with a memo over a recorded signal
  and a component rendered with `@solidjs/web` `render` (happy-dom), after three steps:
  `goto(1)` shows step-1 values in the getter, the memo and the DOM; `steps().length` is unchanged;
  `resume()` shows the latest values; still no new steps.
- **S4 stores restore fine-grained** — a recorded store with two rows (`{ id, text }`); step 1
  changes row 1, step 2 changes row 2; `goto(1)` restores row 2 while an effect reading only row 1's
  text does NOT re-run, and row 1 keeps its object identity when read from the store.
- **S5 writes during travel don't touch the past** — after `goto(1)`, a write to a recorded signal
  (as a timer or handler would) leaves the viewed value unchanged; after `resume()` the write is
  visible and recorded as a new step after the pre-travel latest step.
- **S6 writes held by an action are recorded when they commit** — inside `action(function* () { set(5); yield delay(20); })`:
  while the action is in flight the write is not yet recorded; once the action settles it is
  recorded in one step with value 5.
- **S7 one step per action, final value only** — an action that writes the same recorded signal
  before and after a `yield` records a single step with the final value.
- **S8 recorded async memo** — `createRecordedMemo(() => fetchFn(q()))` with a counting, delayed
  `fetchFn`: after two query changes (and their results) each committed result is recorded;
  `goto(1)` shows step 1's result without calling `fetchFn`; after `resume()` the memo is live
  again (report whether it refetches).
- **S9 a result landing during travel** — an action awaiting a promise, then writing a recorded
  signal; `goto` an earlier step before the promise resolves; resolve it during travel: the viewed
  past is unchanged; after `resume()` the write is visible and recorded.
- **S10 branch** — `goto(1)`, `branch()`: steps after 1 are dropped, live state equals step 1,
  `traveling()` is false, and a new write records step 2 of the new branch.
- **S11 traveling flag and effect re-runs** — `traveling()` is reactive (true after goto, false
  after resume); report (in the test output) how many times a plain user effect over the recorded
  sources re-ran across one goto + resume.

## Performance (`test/perf.test.ts`; log numbers, no assertions)

1. 10,000 writes to one recorded signal, settling after each: total ms and µs per write.
2. 1,000 recorded signals all written in one tick: ms to settle and record.
3. A recorded store with 1,000 rows; 200 steps that each change one row: ms to record all;
   ms for `goto(1)`; ms for `resume()`.
4. The same three numbers for plain (unrecorded) Solid primitives, as a baseline.
