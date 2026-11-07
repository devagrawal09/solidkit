# Field notes: Foldkit Blocks and Effect Layers preview

Written while porting three Solid examples (see [README.md](README.md)) to
`foldkit@0.169.0-canary.f3be22cfeefe` (source commit `f3be22c`), using the
preview's own docs and the pinned `examples/`.

## Measurements

### Type-check time (`tsc --noEmit`, wall clock, three runs, M-series Mac)

| | Compiler | todos | effect | hackernews |
| --- | --- | --- | --- | --- |
| Foldkit port | TS 7.1.0-beta (native, the scaffold's) | 0.40 / 0.40 / 0.40 s | 0.39 / 0.39 / 0.39 s | 0.38 / 0.38 / 0.38 s |
| Foldkit port | TS 6.0.3 (JS), for comparison | 1.18 s | 1.05 s | 1.04 s |
| Solid original | TS 6.0.2 / 6.0.3 (JS, as shipped) | 0.40 s | 0.64 s | 0.64 s |

`--extendedDiagnostics` on the ports (TS 7): todos 1.43 M instantiations and
178 k types; effect 0.83 M and 123 k; hackernews 1.22 M and 129 k. Check time
is 0.13 to 0.15 s, and the rest is startup and I/O.

With the same JS compiler, the ports take about 1.6 to 3 times as long as the
originals, which is the price of the Block graph's types. The native compiler
the scaffold pins erases that difference at this size. **No TS2589**
("excessively deep") errors came up at any point, and every type error I hit
was local and readable (below).

### Line counts (`wc -l`, source only: no CSS, no JSON capture)

| | Original | Port, app code | Port, tests | Port, app code without blanks or comments |
| --- | --- | --- | --- | --- |
| todos | 417 (5 files) | 1,286 (14 files) | 594 | 1,053 (original: 339) |
| effect | 876 (7 files, including the 160-line `solid-effect.ts`) | 1,844 (13 files) | 659 | 1,553 (original: 671) |
| hackernews | 395 (10 files) | 1,071 (13 files) | 297 | 896 (original: 330) |

The ports are formatted by the scaffold's oxfmt at 80 columns; the originals
use 100. They also carry more comments, since they are written to be read
side by side. Even allowing for both, the Foldkit versions are 2.3 to 3.1 times
the code.

## Where Blocks and Layers helped

1. **Interruption is a first-class value.** `SearchPackages.Interrupt({ searchId })`
   is data that update returns, so "superseded searches are interrupted, not
   ignored" is visible in update and assertable in a Story. Resolving the
   Interrupt removes the interrupted Command from the simulation. The Solid
   version needs a 160-line bridge (AsyncIterable `return()` →
   `Fiber.interrupt`, and a custom action driver) for the same thing. Here the
   bridge is the framework, and the real fiber's `onInterrupt` finalizer runs
   (`fibers.test.ts` proves it on a TestClock).
2. **Handler Layers make the `R` channel honest.** Each handler constructor asks
   for its Services once (`TodoApi`, `HnApi`, `EventLog | SearchConfig`), and
   `program.provide(ApplicationLayer)` satisfies them in one place. Swapping in
   a recording `EventLog` and a `TestClock` to run the real handlers took a
   few lines (`effect/src/fibers.test.ts`). The original rides
   `ManagedRuntime` on Solid context, with a fallback runtime that is "only
   sound for `R = never`".
3. **Bindings, OutMessages and operations made the one cross-feature link
   explicit and checked.** NewTodo reports `EnteredTitle`, and the root's fold
   returns `TodosBinding.requestAddTodo({ title })`. An unregistered sibling,
   a missing OutMessage handler or a wrong payload is a type error. Solid's
   `useContext(TodosContext)` is shorter but unchecked.
4. **KeyedQuery covered most of the HN data layer.** Per-key retention,
   in-flight dedupe and late-response protection came for free. Preload is
   then one Subscription plus the same `requestLoadIfMissing` operation used on
   route entry.
5. **Story tests are cheap and precise.** Each saga path (success, decline,
   cancel in each step, the cancel-loses-the-race case) is about 20 lines that
   name Commands and results, with no timers or DOM. Writing them found no
   bugs, but they pin down the race handling better than prose does.
6. **Typed routes.** Every internal href is built by the router that parses it.
7. **The lint presets are useful.** They caught import-order slips, and
   `no-raw-dom-event-attributes` explains the crash-view exception in its own
   message.
8. **DevTools works with no setup.** `devTools: { dispatch: true }` and the Vite
   plugin connected every app, and every log entry, hover intent and Query
   completion is in the timeline.

## Where they hurt

1. **Ceremony.** Every stateful feature needs a Definition, a Composition, an
   init, update and view through the Composition, a private `prepare`, and a
   `Block.FromAssemblyWith…<typeof Model, typeof prepare>` annotation for
   `Block.assemble`. Picking the right annotation (`WithView`,
   `WithViewAndOutMessage`, `WithOutMessage`, `WithoutViewOrOutMessage`) is
   one more decision. Most of the 2 to 3 times line count is this structure
   plus explicit Messages for what Solid does with closures and `refresh`.
2. **A runtime-only rule on `viewInputs`.** Passing an embedded child view
   (`h.block(...)`) inside `viewInputs` type-checks, then throws at render:
   "viewInputs may only contain functions at the top level. Found a function at
   viewInputs.header.data.hook.postdestroy". The fix is a top-level render
   callback (`renderHeader: () => Html`), which Foldkit replays in the parent's
   frame. The docs' own `viewInputs` example passes a plain `h.span`, which
   works, so the hooks are what break it. This is the one place the types and
   the runtime disagreed.
3. **Linear workflows become state machines.** The checkout saga is a 40-line
   generator in Solid. Here it is a `Saga` union (Idle, Running, Compensating)
   and 13 Messages. That is more explicit, since what has committed is in the
   Model and visible in DevTools, but it is longer. Every race (a step
   finishing as its Interrupt lands, `Outcome.NotFound`) must be designed by
   hand. The docs' "Sequencing replacement work" section helps.
4. **There is no "settled" hook from Query to the parent.** Keeping the old page
   up during navigation is derived in the view: the Model stores the previous
   route, and the view shows it until the new route's `AsyncData` leaves
   `Loading`. That is fine, but it is a pattern I had to invent; neither the
   Query nor the route-transition docs cover it. For the same reason, scroll
   to top happens on click, not after the new page renders.
5. **Bypassing an implicit flight takes code.** Every keystroke must name the
   search it interrupts (`maybeRunningSearchId`), and Commands with one shared
   key race their own Interrupt, which the docs warn about. I used per-search
   keys. It is correct and documented, but it is bookkeeping that Solid's
   flight identity does for you.
6. **Scene's limits surprised me.** The CSS subset has no `>` and no
   `:last-child` (it throws "I could not parse the selector"). Text set
   through `InnerHTML` is invisible to `text()`. A boolean prop such as
   `open` reads back as the attribute value `"true"`. And Story's `given`
   and Scene's `given` cannot be mixed in one file; the error is a page-long
   overload message, though the docs do say to use namespaces.
7. **The crash view cannot dispatch.** "Reset" becomes `location.reload()`
   through a raw `onclick`, which needs an `oxlint-disable-next-line` (the
   rule's own message says to do this). Solid's `<Errored>` resets a subtree.
8. **Dev performance warning.** Rendering the 1,406-comment thread fires
   `[foldkit] Slow patch: 17.1ms (budget: 8ms), triggered by GotStoryMessage`.
   It is usable, but the whole view re-renders on every Message (including hover
   intents) unless subtrees are memoized with `createLazy`, which I did not add.
9. **Defaults that cost a debugging loop.** The scaffold's `pnpm format`
   reformats every file it finds, including copied CSS and a 626 kB JSON
   capture, which it pretty-printed to 885 kB. I added ignore patterns.
   Separately, a schema decode failure deep in the comment tree surfaced as a
   readable `SchemaError(Missing key at ["comments"][1]…["content"])` in the
   UI. That was good, but it only showed because errors become Messages.

## Type errors hit (all local, none from the Block machinery)

- `Array.filterMap` in Effect 4 takes a function returning `Result`, not
  `Option` (TS2375 with `exactOptionalPropertyTypes`).
- `Array.isArrayEmpty` rejects a `ReadonlyArray` (TS4104).
- Object literals inside `TaggedUnion.match` widened `kind: 'error'` to
  `string` (TS2322); `Notice.make({...})` fixed it.
- No casts, `@ts-ignore`, `any` or tsconfig changes were needed. The only
  suppression in the code is the crash-view lint comment above.

## Effect 3 → 4 notes (porting `api.ts`)

`Context.Tag` → `Context.Service`; `Effect.catchAll` → `Effect.catch`;
`Effect.fork` → `Effect.forkChild`; `Effect.timeout` fails with
`TimeoutError`; `Array.contains` is gone (I used `Array.some`);
`Schema.Literals`, `Schema.OptionFromOptionalKey` and `Schema.suspend` are
used for the recursive comment Schema. `Data.TaggedError`, `Effect.retry`
with `{ schedule, times, while }`, `Schedule.exponential` and
`Effect.onInterrupt` carried over unchanged.

## Docs and tooling

- **Volume.** The pages I needed came to about 1 MB of Markdown
  (`core/block.md` alone is 114 kB). The migration guide is good at telling
  you what goes where. The pinned `examples/` (todo, interrupting-commands,
  shopping-cart, api-cache-query, route-transitions, workspace) were faster
  for exact call shapes than the prose.
- **`/llms.txt` on the preview site links to `foldkit.dev` URLs.** You have to
  rewrite the host to stay on the preview docs, which matters because the stable
  site documents the older Submodel APIs.
- **Vocabulary.** Terms like "connected Step", "checked execution",
  "occurrence generation" and "delivery envelope" are precise, but they take a
  while to map onto ordinary TEA ideas. The compiler-error table at the end of
  the migration guide is the most practical section.
- **Undocumented in the pages I read:** that `viewInputs` rejects nested
  hook-bearing Html, Scene's selector subset (the docs mention a subset; the
  exact limits only show at runtime), and how to tell the parent a Query entry
  settled.
- **Scaffolding.** `create-foldkit-app` runs non-interactively when given all
  four flags (`--name --rendering --example --package-manager`). It pins the
  canary packages exactly and adds `@foldkit/ui`, Tailwind and
  `@foldkit/devtools-mcp` by default.
