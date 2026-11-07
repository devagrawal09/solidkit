// @solidkit/slices: client state as slices.
//
// A slice is one store per feature, changed only by named, pure, synchronous
// mutations `(draft, ...args) => void`. Every call is committed to the kernel
// with its name and arguments, so replaying the calls reproduces client state
// exactly. There is no message union and no update function: the view calls
// mutations and actions directly, so go-to-definition lands on the behavior.
//
// Everything async stays in Solid. Server data is ordinary derivations (async
// memos, optimistic stores) registered as refreshable; mutations to the server
// are named Solid actions that write optimistic data, yield services, call
// slice mutations for client facts, and refresh.
import { action as solidAction, createContext, createStore, snapshot, useContext } from "solid-js";
import type { Kernel } from "@solidkit/kernel";

/** Changes a draft of the slice's state. Pure, synchronous, deterministic; arguments are JSON data. */
export type Mutation<S> = (draft: S, ...args: any[]) => void;
export type Mutations<S> = Record<string, Mutation<S>>;

/** A slice's mutations bound to its live store. Each returns false when it was ignored (time travel). */
export type Bound<M> = {
  readonly [K in keyof M]: M[K] extends (draft: any, ...args: infer A) => void ? (...args: A) => boolean : never;
};

/** A slice definition: plain data and functions, testable without Solid or a kernel. */
export interface Slice<S extends object, M extends Mutations<S>> {
  readonly name: string;
  readonly initial: S;
  readonly mutations: M;
}

/** Defines a slice. Type the initial state (`const initial: State = ...`) so drafts get the right type. */
export function slice<S extends object, M extends Mutations<S>>(name: string, initial: S, mutations: M): Slice<S, M> {
  return { name, initial, mutations };
}

/** A recorded action: resolves to undefined when ignored while time traveling. */
export type Action<A extends unknown[], R> = (...args: A) => Promise<R | undefined>;

/** What a feature is built with. */
export interface Kit {
  readonly kernel: Kernel;
  /** Mounts a slice: a Solid store tracked by the kernel, and its mutations bound to it. */
  use<S extends object, M extends Mutations<S>>(slice: Slice<S, M>, initial?: S): readonly [state: S, mutations: Bound<M>];
  /** A named Solid action (generator), recorded on the timeline; ignored while time traveling. */
  action<A extends unknown[], R>(
    name: string,
    body: (...args: A) => Generator<unknown, R, any> | AsyncGenerator<unknown, R, any>
  ): Action<A, R>;
  /** Records a promise-returning function built elsewhere (an Effect saga, say) as a named action. */
  recorded<A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>): Action<A, R>;
  /** I/O: recorded live, replayed while time traveling, scripted in tests. */
  services: Kernel["services"];
  /** Data sources (memos, optimistic stores) to re-derive when the timeline moves. */
  refreshable: Kernel["refreshable"];
}

// ── Mounted slices, per kernel ─────────────────────────────────────────────

type Slot = { name: string; slice: Slice<object, Mutations<object>>; initial: unknown; current(): unknown };
const registry = new WeakMap<Kernel, Slot[]>();
const slotsOf = (kernel: Kernel) => registry.get(kernel) ?? [];
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Solid holds a store write that rides a pending transition (an action, a
// route change that suspends), and snapshot() outside the write's own draft
// returns the committed value. The kernel snapshots with snapshot(store) when
// we commit, so a commit made while any slice is held would record stale
// state for it. Each slice therefore keeps its logical state (taken inside the
// draft, where held writes are visible), and we overwrite the kernel's fresh
// snapshot with it. stateAt() hands back the stored snapshot object; writing
// into it is the one place this package reaches past the kernel's API.
function patch(kernel: Kernel, state: Record<string, unknown>) {
  for (const slot of slotsOf(kernel)) state[slot.name] = slot.current();
}

function mount<S extends object, M extends Mutations<S>>(kernel: Kernel, def: Slice<S, M>, initial: S = def.initial) {
  const start = json(initial); // createStore takes ownership of what it is given; keep ours apart
  // Cast: createStore's "not a function" check cannot be resolved for a generic S; slice state is JSON data.
  const [state, setState] = createStore<S>(json(start) as S extends Function ? never : S);
  let current: S = start;
  const others = slotsOf(kernel).filter(s => s.name !== def.name);
  if (others.length !== slotsOf(kernel).length) kernel.record({ kind: "note", text: `remounted slice ${def.name}` });
  // Cast: the registry holds slices of every state type; replay() only hands each its own state.
  const slot: Slot = { name: def.name, slice: def as unknown as Slot["slice"], initial: start, current: () => current };
  registry.set(kernel, [...others, slot]);
  kernel.track(def.name, state, setState);
  patch(kernel, kernel.stateAt(Infinity));

  const bound: Record<string, (...args: unknown[]) => boolean> = {};
  for (const [key, mutation] of Object.entries(def.mutations)) {
    bound[key] = (...args) => {
      if (!kernel.live(`${def.name}.${key}`)) return false;
      const data = json(args); // what the log records is exactly what the mutation sees
      setState(draft => {
        mutation(draft, ...data);
        current = snapshot(draft);
      });
      patch(kernel, kernel.stateAt(kernel.commit(def.name, key, data).seq));
      return true;
    };
  }
  return [state, bound as Bound<M>] as const; // cast: built key by key from def.mutations
}

/** The wiring a feature is built with, for one kernel. */
export function kit(kernel: Kernel): Kit {
  const recorded = <A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>): Action<A, R> =>
    (...args) => (kernel.live(`action ${name}`) ? kernel.action(name, args, () => run(...args)) : Promise.resolve(undefined));
  return {
    kernel,
    use: (def, initial) => mount(kernel, def, initial),
    action: (name, body) => recorded(name, solidAction(body)),
    recorded,
    services: (target, prefix) => kernel.services(target, prefix),
    refreshable: (...sources) => kernel.refreshable(...sources)
  };
}

/**
 * A feature: one function that mounts slices, wraps services, builds data and
 * actions, and returns what the view needs. `create` runs it against a kernel
 * (the app and every test call it); `Context` and `use` hand it to the view.
 */
export function feature<D extends unknown[], T>(build: (kit: Kit, ...deps: D) => T) {
  const Context = createContext<T>();
  return {
    create: (kernel: Kernel, ...deps: D): T => build(kit(kernel), ...deps),
    Context,
    use: (): T => useContext(Context)
  };
}

/**
 * Client state rebuilt from the timeline alone: every mounted slice's initial
 * state with the committed mutation calls re-applied, up to entry `upTo`.
 */
export function replay(kernel: Kernel, upTo = Infinity): Record<string, unknown> {
  const slots = slotsOf(kernel);
  const states: Record<string, object> = Object.fromEntries(slots.map(s => [s.name, json(s.initial) as object]));
  for (const entry of kernel.entries()) {
    if (entry.seq > upTo) break;
    if (entry.kind !== "transition") continue;
    const slot = slots.find(s => s.name === entry.source);
    slot?.slice.mutations[entry.name]?.(states[slot.name], ...((entry.payload as unknown[]) ?? []));
  }
  return states;
}
