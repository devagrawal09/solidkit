# solid-kit: handoff, findings and roadmap

As of 2026-11-07. This records what was built, what was learned, what was decided and what comes next, so the work can be picked up cold. Everything it cites is in this repository or linked. For a quick orientation start with the [README](README.md).

## 1. Summary

**Goal.** solid-kit is a Solid 2–native layer that brings three things from [Foldkit](https://github.com/foldkit/foldkit) to Solid apps: time travel, devtools and domain testing. The constraint is not to weaken Solid: async data, optimistic updates, actions and `<Loading>` boundaries stay inside Solid's reactive graph instead of becoming plain data in a model.

**What the experiments found**

1. **One API style is enough.** Three styles were built and compared on the same three apps. The Slices style (named pure mutations with JSON arguments) ports each app at about the size of the original: 416 source lines against 417 for todos. The message-style Foldkit port is 2.3–3.1× the code. Slices is the chosen direction ([section 4](#4-the-api-style-comparison)).
2. **Time travel works in userland.** With public `solid-js` APIs only, a timeline of recorded signals, stores and memos can rewind. The design that works records committed values from effects and rewinds by overlaying a read view while writing only a cursor, so the present keeps running underneath. It passes all eleven scenarios (35 tests). Recording at the setter and rewinding by writing values back both break around actions ([section 5](#5-userland-time-travel)).
3. **The remaining gap is the past leaking into the present.** While rewound, memos that read recorded stores or plain memos recompute from the past, handlers compute from past values, and `branch()` during an in-flight action loses the action's result. [Section 8](#8-roadmap) lists the fixes.
4. **It found a Solid bug.** `deep()` and `snapshot()` returned the pre-action store when an action that wrote on both sides of a `yield` landed ([solidjs/solid#4552](https://github.com/solidjs/solid/issues/4552)). It was fixed upstream by [#4551](https://github.com/solidjs/solid/pull/4551), merged 2026-11-01. This repository pins rc.19, which still has the bug.

**Status.** Research and prototypes. There is no solid-kit package yet, nothing is published to npm, and the API is not settled. The next work is hardening the overlay primitives, then building solid-kit 0.1 on them ([section 8](#8-roadmap)).

## 2. Goal, decisions and rejected directions

### Decisions

- **Async stays in Solid.** Async memos, `createOptimisticStore`, `action`, `refresh`, `<Loading>`, `isPending` and `latest` remain how async is modelled. Loading and failure state, and command-key cancellation, do not move into a model.
- **Take three things from Foldkit:** time travel, devtools, domain testing.
- **One style:** Slices-style named pure mutations with JSON arguments. No message-style (`Msg`, `update`, `Act`) features.
- **Routing and schemas:** solid-router's Solid 2 `next` branch, and Standard Schema.
- **No separate SolidStart.** It is a Vite plugin option: `solid({ start: {}, ssr: true, serverFunctions: true })`, with `serverFunctions: { components: true }` for server components.
- **Userland only, for now.** Public `solid-js` APIs only. No `clock` from `@solidjs/signals`, no `DEV.hooks.onUpdate`, `onStoreNodeUpdate` or `setWriteHook`, no lane flags (`CONFIG_OVERRIDE`, `CONFIG_GUESS`, `_x._lane`), and no new core `onCommit` hook.
- **Scope.** Simple APIs, small enough to test and ship in a couple of days.

### Rejected directions

- **A @solid-primitives/tape direction** for time travel.
- **A two-surface API** (a store surface plus a data surface, from an earlier solid-kit 0.1 sketch): two ways to define data.
- **State objects whose remote fields become optimistic stores automatically**, with every write funnelled through one mutation function.
- **Async state in the model** ("async and concurrency become plain data").
- **Core changes**, for now. [Section 6.3](#63-requests-for-solid-not-pursued) lists what would help if that changes.

## 3. What's in the repo

| Path | Package | What it is |
|---|---|---|
| `timetravel/` | `@solidkit-tt/setter`, `commit`, `overlay` | Three prototypes of one time-travel API, built against [`SPEC.md`](timetravel/SPEC.md) and the same scenarios S1–S11 plus a perf protocol. Each has a README with its results. **Overlay is the one to continue.** |
| `variants/{slices,messages,blocks}/core` | `@solidkit/slices`, `messages`, `blocks` | The three API styles. Each has `README.md` and `NOTES.md` (what was easy, what was hard, measurements). |
| `variants/*/examples/{todos,effect,hackernews}` | `@solidkit/<style>-<app>` | Ports of Solid's `examples/todos`, `examples/effect` and `examples/hackernews-spa` in each style, with tests and a time-travel test. |
| `kernel/` | `@solidkit/kernel` | The kernel the variants share: timeline, replay, a devtools panel (`devtools.tsx`) and testing helpers (`testing.ts`). 496 lines, 5 tests. It predates the userland design in `timetravel/`. |
| `template/` | `@solidkit/template` | A bare Vite + Solid 2 app skeleton (`index.html`, `src/main.tsx`) wired to the kernel and the test setup. Nothing else in the workspace depends on it. |
| `foldkit-examples/` | not in the workspace | The same three apps ported to Foldkit's Blocks and Effect Layers preview, for comparison. Independent projects with their own lockfiles. |

## 4. The API-style comparison

The same three apps (`todos`, `effect`, `hackernews`) were built five ways: the Solid original, a Foldkit port, and the Slices, Messages and Blocks variants on the shared kernel. Messages and Blocks were message-style and block-style alternatives; they are kept as evidence, not as directions.

**Source lines** (`wc -l` of `src`, no tests, CSS or JSON)

| | Solid original | Foldkit port | Slices | Messages | Blocks |
|---|---|---|---|---|---|
| todos | 417 | 1,286 | 416 | 409 | 461 |
| effect | 876 | 1,844 | 945 | 991 | 1,002 |
| hackernews | 395 | 1,071 | 466 | 464 | 578 |
| core library | | | 184 | 544 | 991 |

The kernel all three share is 496 lines. Blocks' own NOTES.md says 988 for its core; that was an earlier count, and 991 is the current one.

**Tests** (todos / effect / hackernews)

| Foldkit | Slices | Messages | Blocks |
|---|---|---|---|
| 16 / 19 / 9 | 14 / 13 / 11 | 17 / 15 / 12 | 16 / 15 / 13 |

Each example also has a time-travel test (rewind, check the screen and the restored state, assert no live calls).

**Bundle size** (client JS, raw kB / gzip kB). Measured from each built `dist/` with `gzip -9` over all JS assets, so every row uses one method. Vite's own gzip figure is about 0.4–1.2 kB higher; raw sizes match Vite's exactly.

| | Solid original | Foldkit port | Slices | Messages | Blocks |
|---|---|---|---|---|---|
| todos | 86.65 / 31.37 | 431.77 / 133.60 | 96.64 / 35.28 | 98.10 / 35.75 | 109.57 / 39.42 |
| effect | 234.32 / 78.25 | 440.50 / 136.64 | 237.16 / 80.41 | 246.57 / 83.33 | 258.33 / 87.09 |
| hackernews | 216.36 / 75.58 (SSR) | 458.81 / 142.56 | 85.69 / 31.31 | 87.11 / 31.79 | 99.67 / 35.81 |

The original `hackernews-spa` is an SSR app (six chunks including the router, hydration and the server-function client, built 2026-09-12), so it is not comparable with the client-only ports. The ports have no router and keep the 612 KB HN capture out of the bundle (`public/story-30186326.json`). The Solid originals were last built 2026-10-22 (todos, effect).

**Type-check cost.** The Blocks notes record `tsc` wall time with TypeScript 6.0.3: 0.81 s for todos against 0.41 s for the original, with no TS2589 and no editor lag. The Foldkit ports take 0.40 s on the native TypeScript 7 compiler their scaffold pins, and 1.04–1.18 s on TypeScript 6.

**Reading it.** The kernel, its devtools panel and a core cost roughly 11–12 kB raw (about 4.5–5 kB gzip) in Messages and about 23 kB raw (8–9 kB gzip) in Blocks. Slices is the smallest core and the closest to the originals.

### Replay levels

Four levels were distinguished: **inspect** (see the recorded state), **rewind** (restore it), **replay** (re-run recorded inputs through the model) and **effects as data**. Foldkit gets all four because its model is `messages.reduce(update, init)`, at 2.3–3.1× the code. The kernel-based variants have replay (their tests assert the timeline is replayable). The userland design in `5 gives inspect and rewind of recorded state and does not replay inputs.

### Foldkit context

- **Stable 0.169.0:** Effect 4.0.0 as an exact peer, a vendored Snabbdom VDOM, about 90 KB gzipped for a minimal counter.
- **Preview used for the ports:** draft PR [foldkit/foldkit#1655](https://github.com/foldkit/foldkit/pull/1655) "feat!: build applications from Blocks and Effect Layers", branch `codex/layers-and-submodels`, commit `f3be22cfeefed437164ad614d08b16d9000e0703`, package `foldkit@0.169.0-canary.f3be22cfeefe`. Details and pinned packages are in [`foldkit-examples/README.md`](foldkit-examples/README.md); field notes are in [`foldkit-examples/NOTES.md`](foldkit-examples/NOTES.md).

## 5. Userland time travel

### 5.1 The problem

Rewinding Solid state in userland means recording what was committed, restoring it later, and letting memos, effects and the DOM follow. The obstacles, all verified (see [section 6](#6-findings-about-solid-2)): Solid holds writes made in actions until they commit, reads update only after a flush, there is no public end-of-flush hook, and stores are proxies whose reads are tracked.

The shared API, from [`timetravel/SPEC.md`](timetravel/SPEC.md):

```ts
createTimeline(): Timeline
createRecordedSignal(initial, { name, timeline }): [get, set]
createRecordedStore(initial, { name, timeline }): [state, setState]
createRecordedMemo(fn, { name, timeline }): () => T      // fn may be async
// Timeline: steps(), goto(id), resume(), branch(), traveling()
```

### 5.2 Three prototypes, one spec

| Variant | Records | Rewinds by |
|---|---|---|
| `setter` | when the setter is called | writing past values back through the raw setters; writes queued while rewound |
| `commit` | after each flush, from effects | writing past values back; writes queued while rewound |
| `overlay` | after each flush, from effects | writing nothing: getters show recorded values while rewound and the present keeps running underneath |

### 5.3 Results

Scenarios S1–S11 test the desired behavior; a failure is a result, not a bug in the test. Each package was re-run three times with identical results.

| Scenario | setter | commit | overlay |
|---|---|---|---|
| S1 one step per flush | pass | pass | pass |
| S2 updater and equal writes | pass | pass | pass |
| S3 goto/resume add no steps; memos and DOM follow | pass | pass | pass |
| S4 stores restore fine-grained | pass | pass | pass |
| S5 writes during travel | pass, queued | pass, queued | pass, recorded live underneath |
| S6 write held by an action | **fail**: recorded about 20 ms before it commits | pass | pass |
| S7 one step per action, final value | **fail**: records a value that never committed, and `goto` shows it | pass | pass |
| S8 recorded async memo | pass, but refetches on resume | partial: query and result split into two steps unless something renders the memo | pass: no fetches on `goto`, none on resume |
| S9 result landing during travel | pass, queued | pass, queued | pass, recorded during travel, past view unchanged |
| S10 branch | pass | pass | pass |
| S11 `traveling()` flag | pass (effects re-ran 2×) | pass (2×) | pass (2×) |
| Tests | 17 passed, 2 expected failures | 22 passed, 4 expected failures | 35 passed |
| Source | 272 lines | 310 lines | 325 lines |

The expected failures are tests of the desired behavior marked as known failures, not weakened assertions.

**Performance** (each variant measured against its own plain-Solid baseline, so compare within a column)

| | setter | commit | overlay |
|---|---|---|---|
| Per write | about 1.35 µs (plain 0.67) | 0.9–1.5 µs (plain 0.3, plain with one effect 0.44) | about 1.0 µs (plain 0.19–0.4) |
| 1,000-row store, 200 one-row steps | 68 ms | 166–171 ms | 70–75 ms |
| `goto` | 0.54 ms | 1.3–1.4 ms | 0.31–0.36 ms |

The overlay's reads cost about 22 ns per signal read instead of 14, and about 1.65× per store read.

### 5.4 Verdict

**Record at commit time, and rewind by overlaying the view instead of writing to state.**

- **Record at commit, not at the setter.** Wherever Solid separates calling a setter from committing its value (every action), setter-time steps come out early or contain values that never appeared on screen. Commit and overlay get S6 and S7 right.
- **Don't rewind by writing.** If an action holds a write to a source, Solid holds `goto`'s write to that source too, so rewinding during an in-flight save shows nothing until the save lands. Setter and commit found this independently. The overlay writes only a cursor, and it has to write even that twice (below). In return the present keeps running while you look, and resume is one synchronous flush with no replay and no refetch.

### 5.5 How the overlay works (`timetravel/overlay/src/index.ts`)

Every recorded primitive has two layers. A **live** primitive takes all the app's writes and keeps running. A **view** is what everything reads. One cursor decides which one the view shows. Going back in time moves the cursor and nothing else.

**A recorded signal**

```ts
const [live, setLive] = createSignal(initial);
createEffect(live, v => tl.record(src, v));        // records each committed value
const view = createMemo(() =>
  cursor() === LIVE ? live() : src.at(cursor()));  // shows the present or the past
const get = () => (inLane() ? live() : view());    // the "live lane", below
// the setter is setLive: writes always go to the present
```

Because `view` is a memo, a reader re-runs only if the recorded value differs from the present one.

**Recording.**
- The effect receives each value after Solid commits it, so writes an action holds are recorded when the action lands, and only their final value.
- The first value recorded in a tick opens a step and a microtask closes it. If the same source records twice in one tick (two synchronous `flush()` calls) a new step starts. The first run sets the baseline and equal values are skipped.
- Each source stores only the step ids where it changed, with their values. `at(id)` binary-searches them and falls back to the baseline.
- Recording never pauses: while you view the past, the present keeps recording new steps after the latest one.

**Stores** have two pieces:
1. **A tree of memos over the live store**, one per object, each returning a plain copy of its object with children taken from their own memos. A write to `rows[3].text` recomputes that row's memo, then `rows` and the root; every other object keeps its copy. Each recorded step is therefore a new root sharing its unchanged parts with the previous one. This replaced `deep()` (see 6.2).
2. **The `state` you read is a projection**: `createProjection(() => cursor() === LIVE ? plain(live) : src.at(cursor()), {}, { key: "id" })`. It reconciles whichever plain tree it gets, keyed by `id`. Shared parts are skipped by reference and only differing values notify, so rows keep their proxies, `<For>` keeps its DOM nodes, and an effect on an untouched row does not re-run. `setState` writes to the live store.

**Recorded memos** are a live memo over `fn`, the recording effect, and a view memo like the signal's. For an async memo the effect records the resolved value, and the first value becomes the baseline.

**goto, resume, branch**
- `goto(id)` closes the open step and moves the cursor. No recorded source is touched.
- `resume()` moves the cursor back. The view shows whatever the present is now, including anything that happened while away.
- `branch()` is the only call that writes state. It drops every step after the cursor, writes each source's value at the cursor into the live primitive (signals via `set(() => v)`, stores via `reconcile(clone, "id")` with a positional fallback, memos recompute), and skips recording the echo.

**Two tricks that avoid core changes**
- **The cursor is written twice.** The view memos read the cursor and the live sources. If an action is holding a write to a live source, a plain cursor write is held too, so `goto` would not show until the action finished. The cursor is therefore a plain signal plus `createOptimistic(() => base())`, and `goto` writes both. `branch()` writes only the plain one, so a held restore keeps showing the branch point until it lands.
- **The live lane.** Recorded memos must compute from the present, or an async memo would refetch with past inputs on every `goto`. Each recorded memo registers its own computation (`getObserver()`) in a WeakSet, and a recorded getter read *directly* by one of them returns `live()` instead of `view()`.

### 5.6 Known leaks

The live lane only checks the getter's immediate reader, so the past gets through here:
- **Through a plain memo.** A recorded memo that reads a plain memo that reads a recorded signal recomputes from the past and records bogus steps on `goto` and `resume`.
- **Through the store.** A recorded memo that reads a recorded store's `state` sees the projection, because stores have no live path. Routing reads through a proxy fixes it but makes `deep(state)` stop tracking.
- **In handlers.** Handlers have no reader, so at step 1, `setX(x() * 10)` writes 20 into the present instead of 30.
- **In `branch()` during an action.** The action's result is dropped.

These are asserted as limitations in `timetravel/overlay/test/probes.test.ts` and listed in its README.

## 6. Findings about Solid 2

### 6.1 Behaviors verified (Solid 2.0.0-rc.19 and a local build of `next`)

- **Writes in an owned scope throw** `REACTIVE_WRITE_IN_OWNED_SCOPE` (opt out with `ownedWrite: true`). Writes belong in handlers, actions, an effect's apply phase and `onSettled`.
- **Reads update only after a flush** (microtask batching).
- **`createStore(obj)` takes ownership of `obj`** and later writes mutate it in place, so clone fixtures.
- **`reconcile` stays fine-grained and keeps proxy identity.** A keyed reconcile at the root throws "Cannot reconcile states with different identity"; use `reconcile(value, null)` for a positional restore.
- **`snapshot(store)` is immutable** and shares unchanged parts. Frozen objects are leaves.
- **A plain write in the same tick as starting an action is held** until the action settles. Start actions after a flush.
- **Held writes are invisible to `snapshot()`.** Writes inside an action stay invisible until it settles, except inside that store's own draft. A timeline that snapshots from outside the setter records the wrong state while a write is held (the Slices notes call this the big one).
- **`deep(store)` in an effect's compute phase** subscribes to every nested property and returns a plain snapshot.
- **A wrapped `async function*` delays close:** `return()` queues behind a pending `next()`, so Solid closing a superseded stream does not reach the inner iterator until it finishes. The kernel's backends therefore take an `AbortSignal`.
- **`live` and `broadcast`** (experimental) are server-function wrappers in `@solidjs/web/server-functions` that return a reconnecting `LiveSource`.

### 6.2 Issues found in Solid

1. **`deep()` and `snapshot()` were stale when an action that wrote a store on both sides of a `yield` landed.** Per-key reads showed the writes; `deep()`/`snapshot()` in the same pass returned the pre-action store, and nothing re-ran, so the stale value stuck. Filed as [#4552](https://github.com/solidjs/solid/issues/4552). It is a regression from 1b9ceb679 (#3774, "the hold model (L2)"), where the store rebuild replaced the visibility check added for #3147 (aa03f76e) with a flag test. The parent commit, 41fdf9696, passes. **Fixed upstream by [#4551](https://github.com/solidjs/solid/pull/4551)**, merged 2026-11-01. A duplicate PR ([#4553](https://github.com/solidjs/solid/pull/4553)) was closed in its favor. The overlay's tree of memos sidesteps the bug, and recorded a 1,000-row store about 7× faster than `deep()` (513 ms against 73 ms), so it stays either way.
2. **There is no userland hook for the end of a flush.** Steps are grouped per microtask, so two synchronous flushes of different sources share a step.
3. **A query and its async result land in separate steps** unless a rendered component reads the memo. Solid only holds the query write while something waits on the result.
4. **Recording a store costs time proportional to its size on every change**, and triggers the `HUGE_FAN_IN` dev warning at 1,000 rows.

### 6.3 Requests for Solid (not pursued)

Core changes are out of scope for now. If that changes, these would remove the overlay's remaining gaps:
- A way to run code at the end of the current flush.
- A real lane or fork primitive, or a public read-through hook for stores, so derived state can run on the present while the view shows the past.

## 7. Open problems

- **Overlay leaks** (section 5.6).
- **Store recording cost.** Every change rebuilds the whole array's copy. Plan: split each array's memo into chunks.
- **Kernel issues** (in `kernel/`, possibly moot once the API is rebuilt on the recorded primitives): close recorded streams promptly; commit when the transition lands; queue results while rewound; let `refreshable()` unregister; record error names and fields.
- **solid-router `query` wrapping.** Unconfirmed: whether wrapping `query` keeps its revalidation dependency, and whether single-flight data seeds the cache in a way that bypasses a wrapper.
- **Production agent permissions.** What agents may do in production, if actions are exposed as MCP tools.
- **The npm name.**

## 8. Roadmap

### Step 1: harden the time-travel primitives (about a day)

- **Give each recorded source two sides**, `live` for model code and `view` for components. The Slices-style framework knows which code is a mutation, a derived value or async data (model) and which is a component (view), so it can hand each the right side. That replaces the live-lane hack and closes the leaks through plain memos and stores; the leak tests should flip from documenting the leak to passing.
- **Lock input while rewound**, with a bar showing "Viewing step N: Resume / Branch here". The present keeps running underneath. This also stops handlers from passing stale arguments, such as the id of a row that no longer exists.
- **Disable `branch()` while an action is in flight**, which fixes the lost action result.
- **Chunk store arrays** into memos so a change re-copies one chunk, not the whole array. This also silences `HUGE_FAN_IN`.
- **Keep the tree of memos** after #4551 lands.

### Step 2: solid-kit 0.1 on top (about a day)

- A slice definition: state, named mutations with Standard Schema arguments, derived values and async data, wired to the `live` side.
- Steps named by the mutations that caused them (approximate: each step gets the mutations called since the previous one).
- A minimal devtools panel: the step list, a scrubber, Resume and Branch.
- A testing helper that runs mutations without a DOM and checks the state and the steps they produce.
- Port todos and compare with the Slices variant on size, tests and bundle.

### Decisions needed before Step 1

| Decision | Options | Recommendation |
|---|---|---|
| Input while rewound | block it; queue it and apply on resume; branch automatically on the first write | block it |
| Where it lives, and the npm name | this repo (`timetravel/kit` for now) or its own repo | this repo for now, pick the name later |
| MCP access for agents | in 0.1, or after | after, so 0.1 is time travel, devtools and testing only |

### After 0.1

- **Agents.** Slices' schema'd actions exposed as MCP tools.
- **Router.** Integrate solid-router `next` (section 10), once `query` wrapping and single-flight are confirmed.
- **SSR and server functions** through the Vite plugin option (section 2).
- **Fuller devtools.**

## 9. Toolchain and how to resume

- **Versions.** `solid-js` and `@solidjs/web` 2.0.0-rc.19; `@solidjs/vite-plugin` 3.0.0-next.50; vitest ^5.0.5 with happy-dom 21.0.4; TypeScript ~6.0.3; vite ^8.3.5; pnpm 11.1.1; developed on Node 24. The Blocks variant also uses Effect 3.22.4.
- **Commands.** `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` from the root run every workspace package (one at a time). A single package: `pnpm --filter @solidkit-tt/overlay test`. The Foldkit ports are separate: `cd foldkit-examples/todos && pnpm install && pnpm dev`, with `typecheck`, `test`, `lint` and `build` scripts; browser smoke scripts are in `foldkit-examples/smoke/`.
- **Vitest setup** (see any `timetravel/*/vitest.config.ts`): the Solid Vite plugin, happy-dom, resolve conditions `browser` and `development`, `solid-js` and `@solidjs/web` deduped, and dependencies matching `/solid-js/` and `/@solidjs\//` inlined so the client build loads.
- **Test conventions.** A `settled()` helper (a few rounds of `await new Promise(r => setTimeout(r, 0)); flush();`). Clone store fixtures. The time-travel scenarios are named S1–S11 in `test/spec.test.ts` in each package.
- **Import check.** On 2026-11-07, from a clean `pnpm install --frozen-lockfile` of this tree, `pnpm typecheck`, `pnpm test` (242 tests across 16 packages, 6 expected failures, 0 failed) and `pnpm build` all passed. In `foldkit-examples/` each of the three ports passed install, typecheck, test (16 / 19 / 9 tests) and build; lint was not re-run.

## 10. References

- **Solid 2:** [solidjs/solid](https://github.com/solidjs/solid), branch `next`. In that repo: `packages/solid/CHEATSHEET.md` and `documentation/solid-2.0/` (01 reactivity and batching, 04 stores, 05 async data, 06 actions and optimistic, 10 server functions including `live` and `broadcast`).
- **solid-router `next`** (2.0.0-next.43): `createRouter({ routes, history, preloadLinks: intentPreload() })`, `defineRoutes`, `paths`. History is `RouterHistory { get, set, init?(notify), utils? }` with `browserHistory()`, `hashHistory()` and `memoryHistory()`. Data: `query`, `liveQuery`, `formAction`, `useSubmissions`; single-flight is on by default. Preload `intent` is one of initial, navigate, native, preload.
- **solid-primitives `next` conventions.** `make*` primitives are non-reactive and `create*` primitives are reactive. `package.json` carries a `"primitive": { name, stage, list, category }` field and new entries start at stage 0. Reusable pieces: `flux-store`, `deep`, `async`, `state-machine`, `queue`, `scheduled`, `storage`, `url`. The `history` package (`createUndoHistory`) is a per-history undo stack, not a shared timeline.
- **Foldkit preview docs:** https://foldkit-website-preview-ky42cyp8l-devin-jamesons-projects.vercel.app (`/llms.txt`, `/preview-migration.md`, `/preview-release.json`). A preview deployment, so it may disappear.
- **Upstream:** solidjs/solid [#4552](https://github.com/solidjs/solid/issues/4552) (closed), [#4551](https://github.com/solidjs/solid/pull/4551) (merged), [#4553](https://github.com/solidjs/solid/pull/4553) (closed duplicate).

## 11. History and what's missing

- **Earlier sketches are gone.** A command-based v1 and a `program({ init, update, data, actions, ... })` v2 sketch (with counter, todos, hackernews, typeahead and sierpinski examples), plus two feasibility probes, lived in a temporary directory that was cleared. Their designs were superseded by the variants; the typeahead and sierpinski examples were not ported to the variants.
- **Provenance.** The variants and the time-travel prototypes were written by coding-agent sessions working from shared briefs and specs. Typecheck and tests were re-run independently of those sessions before results were recorded here.
- **Not included:** the solid-router and Solid checkouts used for reading, and any Solid or solid-primitives changes (the one Solid contribution was #4552/#4551, above).
