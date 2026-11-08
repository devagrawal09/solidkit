# @solidkit-tt/tracked: time travel on Solid's `flush` record

`createTracked(createSignal, 0, { name: "count" })` returns what
`createSignal(0, { name: "count" })` returns, recorded on a timeline and rewound
by it. It supports `createSignal`, `createOptimistic`, `createMemo`, `createStore`,
`createOptimisticStore` and `createProjection`.

Recording is done by Solid: every drain delivers a `flush` record listing what it
changed on screen and who staged each value. This package needs no recording
effects, no microtask grouping and no store copies of its own. Rewinding is the
overlay from `timetravel/overlay`.

`tsc`: clean. `vitest`: 16/16 pass (S1–S11 from [`../SPEC.md`](../SPEC.md), plus
S1b and 4 attribution tests).

## Requirements

This package needs Solid with `FlushEvent.changes`, from the
[`tembo/observe-commit`](https://github.com/devagrawal09/solid/tree/tembo/observe-commit)
branch (not released yet). It links `solid-js` and `@solidjs/web` from a sibling
checkout, so it sits outside the pnpm workspace and has its own install:

```sh
# next to solidkit/
git clone -b tembo/observe-commit https://github.com/devagrawal09/solid
cd solid && pnpm install && pnpm turbo run build --filter='./packages/*' --filter='!@solidjs/compiler'
cd ../solidkit/timetravel/tracked && pnpm install --ignore-workspace && pnpm test
```

Time travel runs in Solid's dev build, and `createTimeline()` turns the
attribution engine on with its findings off.

## API

```ts
const timeline = createTimeline();   // the active timeline; create it before tracking
const [count, setCount] = createTracked(createSignal, 0, { name: "count" });
const doubled = createTracked(createMemo, () => count() * 2, { name: "doubled" });
const [todos, setTodos] = createTracked(createStore, { items: [] }, { name: "todos" });

timeline.steps();   // [{ id, changes: { count: 1 }, actions: ["save"], cause: "click on button#inc" }]
timeline.goto(id); timeline.resume(); timeline.branch();
timeline.traveling(); timeline.cursor(); timeline.dispose();
```

A step is one drain that changed something tracked:
- **`changes`**: the tracked values it changed, by name. A store's entry is the whole store at that step.
- **`actions`**: the actions whose writes it shows. That includes an action's in-flight optimistic writes and its landing, which can come later.
- **`cause`**: the interaction (or navigation) it traces to, when one is known.

## How it works (`src/index.ts`)

**Recording.** `createTimeline` subscribes to `OBSERVE.records` `"flush"` with
`{ bodies: true }`. Each change arrives with its node and its values before and
after (`live.changes`). Changes are matched to tracked primitives as follows:
- **Signals, optimistic signals and memos.** At creation, `createTracked`
  finds the primitive's internal node by reading its getter in a throwaway memo
  and asking `DEV.getSources` for the source. Changes are matched to that node.
- **Stores.** A store property's node points to its store (`_host`, up to the
  root's proxy). A drain that changed a tracked store records `snapshot(store)`
  at the drain's end, which shares unchanged parts with earlier snapshots.
- **Async memos.** An async memo's first answer isn't a change (it's a first
  value). It becomes the baseline when the first change arrives with it as `prev`.

**Rewinding.** This is unchanged from the overlay:
- **Cursor.** It's a plain signal plus `createOptimistic` over it, written together.
- **Signals and memos.** Each getter is a view memo:
  `cursor === LIVE ? live() : history.at(cursor)`.
- **Stores.** The store is a `createProjection` keyed by `id` over
  `deep(liveStore)` or the recorded snapshot. `deep` matters here: it
  subscribes to every property of the live store, which no reader would
  otherwise do, so its changes reach the record.
- **Live lane.** Tracked memos compute in the live lane, so traveling never
  refetches.
- **Branch.** `branch()` restores the viewed step into the live primitives and
  skips its own echo.

The timeline's own nodes (view memos, the cursor, the store views) are named with
a reserved prefix and filtered out of the record.

## Compared with `timetravel/overlay`

| | overlay | tracked |
|---|---|---|
| Step boundary | microtask (two synchronous flushes merge) | the drain (exact; S1b) |
| Recording cost | one effect per primitive; a tree of memos copying stores | none of its own; one snapshot per changed store per drain |
| Held writes (S6/S7) | recorded from effects at commit | Solid reports them at their landing |
| Attribution | none | actions, interaction or navigation per step |
| Optimistic values | recorded as their committed value | a step when shown and when lifted, rewindable |

## Known limits

- **Only tracked state rewinds.** Untracked signals a component reads stay in
  the present. Wrap everything you want to rewind (a Vite plugin that swaps
  `solid-js` imports for tracked ones is the planned fix).
- **Leaks through plain memos.** A tracked memo that reads a plain memo that
  reads a tracked signal recomputes from the past while traveling. This is the
  same as the overlay prototype.
- **Handlers read the view.** While rewound, a handler like `setX(x() * 10)`
  computes from the past. Lock input while rewound.
- **`branch()` during an in-flight action** drops the action's result.
- **The live store side is `deep()`.** That subscribes to every property, so
  `HUGE_FAN_IN` warns past 2,000 properties.
- **Internal fields.** Matching relies on a store property node's `_host`
  chain and on `DEV.getSources`, both dev-build details. Not ported yet: the
  overlay's probes and performance tests.
