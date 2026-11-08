/**
 * Time travel over the tracked part of the reactive graph, on Solid's
 * `flush` record.
 *
 * Recording is Solid's: every drain delivers a `flush` record whose
 * `changes` list what the drain changed on screen — a commit, an action's
 * landing, an optimistic value appearing or lifting — each with the origin
 * that staged it (the action step, effect, interaction). A drain that
 * changed a tracked primitive is one step. Nothing here runs per write.
 *
 * Rewinding is the overlay: `goto` writes nothing to the tracked state. It
 * moves a cursor, and every tracked getter (and a tracked store's proxy) is
 * a view that shows the recorded value while traveling and the live one
 * otherwise. The live primitives keep running underneath: writes land in the
 * present, async work resolves, and new steps are recorded during travel.
 * `resume` moves the cursor back; `branch` makes the viewed step the present.
 *
 * Two details carried over from the overlay prototype:
 * - The cursor is written twice, a plain signal plus a `createOptimistic`
 *   over it: an action holding a write to a viewed source holds a plain
 *   cursor write too, and the optimistic layer shows the move at once.
 * - Tracked memos compute in the "live lane": a tracked getter read directly
 *   by a tracked memo's own computation returns the live value, so a memo
 *   never recomputes (or refetches) from the past while you look at it.
 *
 * Requires Solid with `FlushEvent.changes` (dev or observe build) and turns
 * the attribution engine on (its findings off).
 */
import {
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRoot,
  deep,
  createSignal,
  createStore,
  DEV,
  getObserver,
  OBSERVE,
  reconcile,
  snapshot,
  untrack
} from "solid-js";
import type {
  Accessor,
  ComputeFunction,
  MemoOptions,
  NoInfer,
  ProjectionOptions,
  Signal,
  SignalOptions,
  Store,
  StoreOptions,
  StoreSetter
} from "solid-js";
import { attribution } from "solid-js/attribution";

export interface StepChange {
  /** The tracked primitive's name. */
  name: string;
  value: unknown;
}

export interface Step {
  id: number;
  /** The tracked values this step changed, by name. */
  changes: Record<string, unknown>;
  /** The actions whose writes this step shows (an action's landing, its optimistic writes). */
  actions: string[];
  /** The interaction (or navigation) the step traces to, when one is known: `click on button#save`. */
  cause?: string;
}

export interface Timeline {
  steps(): readonly Step[];
  goto(id: number): void;
  resume(): void;
  branch(): void;
  traveling(): boolean;
  /** The viewed step id, or -1 when live. */
  cursor(): number;
  dispose(): void;
}

const LIVE = -1;
const NONE: unknown = Symbol("none");
/** Names of the timeline's own nodes: filtered out of the record. */
const INTERNAL = "\u0000tt";

/** One tracked primitive's history: the step ids it changed at, with values. */
class History {
  ids: number[] = [];
  values: unknown[] = [];
  constructor(public baseline: unknown) {}
  at(id: number): unknown {
    let lo = 0;
    let hi = this.ids.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ids[mid] <= id) (found = mid), (lo = mid + 1);
      else hi = mid - 1;
    }
    return found < 0 ? this.baseline : this.values[found];
  }
  last(): unknown {
    return this.ids.length ? this.values[this.values.length - 1] : this.baseline;
  }
  record(id: number, value: unknown): void {
    this.ids.push(id);
    this.values.push(value);
  }
  cut(after: number): void {
    while (this.ids.length && this.ids[this.ids.length - 1] > after) this.ids.pop(), this.values.pop();
  }
}

interface Tracked {
  name: string;
  history: History;
  /** Make `value` the present (branch). */
  restore(value: unknown): void;
  /** Store: snapshot the live store at a drain end. */
  capture?(): unknown;
}

interface TimelineState {
  timeline: Timeline;
  cursor: () => number;
  byNode: WeakMap<object, Tracked>;
  byStore: WeakMap<object, Tracked>;
  /** Branch's own writes coming back: skipped once if equal. */
  echoes: Map<Tracked, unknown>;
}

let active: TimelineState | null = null;

/** Structural equality for plain data (the branch echo). */
function same(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => same(a[k], b[k]));
}

/** Copies plain objects and arrays; anything else by reference. */
function clonePlain(v: any): any {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clonePlain);
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = clonePlain(v[k]);
  return out;
}

/** A store property node's store: its host target's root proxy. */
function storeOf(node: any): object | undefined {
  let t = node?._host;
  if (!t) return undefined;
  while (t.u) t = t.u;
  return t.px;
}

/** The node behind a getter: read it in a throwaway memo and ask for its source. */
function nodeOf(read: () => unknown): object | undefined {
  if (!DEV) return undefined;
  let observer: any;
  let node: object | undefined;
  createRoot(dispose => {
    const probe = createMemo(
      () => {
        observer = getObserver();
        try {
          read();
        } catch {
          // Pending: the read still linked the node.
        }
      },
      { name: INTERNAL + ".probe" } as any
    );
    try {
      probe();
    } catch {}
    if (observer) node = DEV!.getSources(observer)[0];
    dispose();
  });
  return node;
}

function label(origin: any): string | undefined {
  if (!origin) return undefined;
  if (origin.kind === "interaction")
    return `${origin.name ?? "interaction"}${origin.target ? ` on ${origin.target}` : ""}`;
  if (origin.kind === "navigation") return `navigation to ${origin.to ?? origin.name}`;
  return origin.interaction ? label(origin.interaction) : undefined;
}

export function createTimeline(): Timeline {
  if (!OBSERVE || !DEV) throw new Error("time travel needs Solid's dev build");
  attribution.enable({
    log: false,
    checks: false,
    waterfalls: false,
    holds: false,
    longHolds: false,
    graphGrowth: false,
    abandonedFlights: false,
    fallbackFlashes: false,
    optimisticReverts: false,
    stackedHolds: false
  });

  // Co-written cursor (see the header).
  const [base, setBase] = createSignal(LIVE, { name: INTERNAL + ".base" } as any);
  const [cursor, setCursor] = createOptimistic<number>(() => base(), {
    name: INTERNAL + ".cursor"
  } as any);
  const move = (id: number) => {
    setBase(id);
    setCursor(id);
  };
  const traveling = createMemo(() => cursor() !== LIVE, { name: INTERNAL + ".traveling" } as any);

  const log: Step[] = [];
  const [steps, setSteps] = createSignal<readonly Step[]>([], {
    name: INTERNAL + ".steps"
  } as any);
  let nextId = 1;
  const tracked = new Set<Tracked>();

  const state: TimelineState = {
    timeline: null!,
    cursor,
    byNode: new WeakMap(),
    byStore: new WeakMap(),
    echoes: new Map()
  };

  const off = OBSERVE.records.subscribe(
    "flush",
    (event, live) => {
      const step: Step = { id: nextId, changes: {}, actions: [] };
      const stores = new Set<Tracked>();
      let any = false;
      let cause: string | undefined;
      for (let i = 0; i < event.changes.length; i++) {
        const change = event.changes[i];
        if (change.nodeName.startsWith(INTERNAL)) continue;
        const { node, prev, value } = live.changes[i];
        const store = storeOf(node);
        const t = store !== undefined ? state.byStore.get(store) : state.byNode.get(node);
        if (t === undefined || !tracked.has(t)) continue;
        if (change.origin?.kind === "action" && change.origin.name && !step.actions.includes(change.origin.name))
          step.actions.push(change.origin.name);
        cause ??= label(change.origin);
        if (store !== undefined) {
          stores.add(t);
          continue;
        }
        // A first value we never saw (an async memo's first answer) is the baseline.
        if (t.history.baseline === NONE) t.history.baseline = prev;
        if (state.echoes.has(t) && same(state.echoes.get(t), value)) {
          state.echoes.delete(t);
          continue;
        }
        step.changes[t.name] = value;
        any = true;
      }
      for (const t of stores) {
        const value = t.capture!();
        if (state.echoes.has(t) && same(state.echoes.get(t), value)) {
          state.echoes.delete(t);
          continue;
        }
        if (Object.is(value, t.history.last())) continue;
        step.changes[t.name] = value;
        any = true;
      }
      if (!any) return;
      if (cause !== undefined) step.cause = cause;
      for (const t of tracked) if (t.name in step.changes) t.history.record(step.id, step.changes[t.name]);
      nextId++;
      log.push(step);
      // Records arrive inside the engine, which must not be written to: publish after.
      queueMicrotask(() => setSteps(log.slice()));
    },
    { bodies: true }
  );

  const timeline: Timeline = {
    steps,
    traveling,
    cursor,
    goto(id) {
      move(Math.max(0, Math.min(id, nextId - 1)));
    },
    resume() {
      move(LIVE);
    },
    branch() {
      const at = untrack(cursor);
      if (at === LIVE) return;
      const cut = log.findIndex(s => s.id > at);
      if (cut >= 0) log.length = cut;
      nextId = at + 1;
      for (const t of tracked) {
        const value = t.history.at(at);
        const current = t.history.last();
        t.history.cut(at);
        if (value === NONE || same(value, current)) continue;
        state.echoes.set(t, value);
        t.restore(value);
      }
      setSteps(log.slice());
      // Only the plain cursor: a restore an action holds lands with it, and
      // until then the optimistic layer keeps showing the branch point.
      setBase(LIVE);
    },
    dispose() {
      off();
      attribution.disable();
      if (active === state) active = null;
    }
  };
  state.timeline = timeline;
  (state as any).tracked = tracked;
  active = state;
  return timeline;
}

// --- The live lane -------------------------------------------------------------

/** Computations of tracked memos: a tracked getter read directly by one reads live. */
const lane = new WeakSet<object>();
let laneDepth = 0;
const inLane = () => {
  if (laneDepth === 0) return false;
  const o = getObserver();
  return o != null && lane.has(o);
};

function current(): TimelineState {
  if (!active) throw new Error("createTracked: create a timeline first (createTimeline())");
  return active;
}

let unnamed = 0;
function nameOf(options: any, kind: string): string {
  return options?.name ?? `${kind}${++unnamed}`;
}

function register(state: TimelineState, t: Tracked): void {
  ((state as any).tracked as Set<Tracked>).add(t);
}

/** A getter that shows the recorded value while traveling. */
function viewOf<T>(state: TimelineState, live: () => T, history: History): () => T {
  const view = createMemo<T>(
    () => {
      const c = state.cursor();
      if (c === LIVE) return live();
      const v = history.at(c);
      return (v === NONE ? live() : v) as T;
    },
    { name: INTERNAL + ".view" } as any
  );
  return () => (inLane() ? live() : view());
}

function trackSignal(create: (...args: any[]) => any, args: any[], kind: string): any {
  const state = current();
  const [live, set] = create(...args);
  const options = typeof args[0] === "function" ? args[1] : args[1];
  let initial: unknown = NONE;
  try {
    initial = untrack(live);
  } catch {}
  const t: Tracked = {
    name: nameOf(options, kind),
    history: new History(initial),
    restore: v => void set(() => v)
  };
  const node = nodeOf(live);
  if (node) state.byNode.set(node, t);
  register(state, t);
  return [viewOf(state, live, t.history), set];
}

function trackMemo(args: any[]): any {
  const state = current();
  const [fn, ...rest] = args;
  const live = createMemo(
    (prev: unknown) => {
      lane.add(getObserver()!);
      laneDepth++;
      try {
        return fn(prev);
      } finally {
        laneDepth--;
      }
    },
    ...rest
  );
  const options = rest[0];
  let initial: unknown = NONE;
  try {
    initial = untrack(live);
  } catch {}
  const t: Tracked = {
    name: nameOf(options, "memo"),
    history: new History(initial),
    restore: () => {} // a memo re-derives from its restored sources
  };
  const node = nodeOf(live);
  if (node) state.byNode.set(node, t);
  register(state, t);
  return viewOf(state, live as () => unknown, t.history);
}

function trackStore(proxy: any, setState: ((fn: (draft: any) => void) => void) | undefined, options: any, kind: string): any {
  const state = current();
  const t: Tracked = {
    name: nameOf(options, kind),
    history: new History(snapshot(proxy)),
    restore: v =>
      setState?.((draft: any) => {
        // A clone, so recorded objects never become the live store's backing.
        try {
          reconcile(clonePlain(v), "id")(draft);
        } catch {
          reconcile(clonePlain(v), null)(draft);
        }
      }),
    capture: () => snapshot(proxy)
  };
  state.byStore.set(proxy, t);
  register(state, t);
  // What everything reads: the live store, or a recorded snapshot, reconciled
  // into one projection keyed by `id` — rows keep their proxies and only the
  // values that differ notify.
  const view = createProjection(
    () => {
      const c = state.cursor();
      // `deep` subscribes to every property of the live store: its changes
      // reach the flush record (and this view) even when only the view is read.
      return (c === LIVE ? deep(proxy) : t.history.at(c)) as any;
    },
    (Array.isArray(untrack(() => snapshot(proxy))) ? [] : {}) as any,
    { key: "id", name: INTERNAL + ".view" } as any
  );
  return view;
}

type Primitive = (...args: any[]) => any;

/**
 * Track a Solid primitive: `createTracked(createSignal, 0, { name: "count" })`
 * returns what `createSignal(0, { name: "count" })` returns, recorded on the
 * active timeline and rewound by it. Supports `createSignal`,
 * `createOptimistic`, `createMemo`, `createStore`, `createOptimisticStore`
 * and `createProjection`. Name what you track: the name is the step's key.
 */
export function createTracked<T>(
  create: typeof createSignal | typeof createOptimistic,
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createTracked<T>(
  create: typeof createSignal | typeof createOptimistic,
  fn: ComputeFunction<T>,
  options?: SignalOptions<T> & MemoOptions<T>
): Signal<T>;
export function createTracked<T>(
  create: typeof createMemo,
  fn: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: MemoOptions<T>
): Accessor<T>;
export function createTracked<T extends object>(
  create: typeof createStore | typeof createOptimisticStore,
  value: T,
  options?: StoreOptions & { name?: string }
): [Store<T>, StoreSetter<T>];
export function createTracked<T extends object>(
  create: typeof createProjection,
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: T,
  options?: ProjectionOptions
): Store<T>;
export function createTracked(create: Primitive, ...args: any[]): any {
  if (create === (createSignal as Primitive)) return trackSignal(create, args, "signal");
  if (create === (createOptimistic as Primitive)) return trackSignal(create, args, "optimistic");
  if (create === (createMemo as Primitive)) return trackMemo(args);
  if (create === (createStore as Primitive) || create === (createOptimisticStore as Primitive)) {
    const [proxy, setState] = create(...args);
    const options = typeof args[0] === "function" ? args[2] : args[1];
    return [trackStore(proxy, setState, options, "store"), setState];
  }
  if (create === (createProjection as Primitive)) {
    const proxy = create(...args);
    return trackStore(proxy, undefined, args[2], "projection");
  }
  throw new Error("createTracked: unsupported primitive");
}
