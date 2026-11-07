// @solidkit/kernel: the essentials every solid-kit variant shares.
//
// - A timeline of named transitions, action lifecycles and service calls.
// - A snapshot of all tracked client state after every transition.
// - Services that are recorded live, replayed while time traveling, and
//   scripted in tests. Async stays in Solid: memos, optimistic stores and
//   actions call services; the kernel only sits at that boundary.
import { createSignal, reconcile, refresh, snapshot } from "solid-js";

export type EntryBody =
  | { kind: "transition"; source: string; name: string; payload?: unknown }
  | {
      kind: "action";
      phase: "start" | "settled" | "failed";
      name: string;
      id: number;
      payload?: unknown;
      error?: string;
    }
  | {
      kind: "service";
      phase: "call" | "result" | "error";
      path: string;
      key: string;
      id: number;
      args?: unknown;
      value?: unknown;
      error?: string;
      shape?: "value" | "promise" | "iterable";
      replayed?: boolean;
    }
  | { kind: "note"; text: string };

export type Entry = EntryBody & { readonly seq: number; readonly at: number };

export type ScriptedCall = {
  readonly path: string;
  readonly args: readonly unknown[];
  resolve(value?: unknown): void;
  reject(error: unknown): void;
};

type Tracked = { name: string; read(): unknown; restore(value: unknown): void };
type Tape = { kind: "live" } | { kind: "replay"; seq: number } | { kind: "script" };

/** JSON-safe copy for the log (also strips store proxies). */
export function loggable(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

const keyOf = (args: readonly unknown[]) => {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
};
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isPromiseLike = (v: unknown): v is PromiseLike<unknown> =>
  !!v && typeof (v as PromiseLike<unknown>).then === "function";
const isAsyncIterable = (v: unknown): v is AsyncIterable<unknown> =>
  !!v && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";

export type Kernel = ReturnType<typeof createKernel>;

export function createKernel(options: { limit?: number; script?: boolean } = {}) {
  const limit = options.limit ?? 5000;
  let log: Entry[] = [];
  let seq = 0;

  // The timeline is read by the devtools panel. Entries can be recorded from
  // inside computations (a memo calling a service), where Solid forbids
  // writes, so the panel is told in a microtask instead.
  const [version, setVersion] = createSignal(0);
  let bumpQueued = false;
  function bump() {
    if (bumpQueued) return;
    bumpQueued = true;
    queueMicrotask(() => {
      bumpQueued = false;
      setVersion(v => v + 1);
    });
  }

  function record(body: EntryBody): Entry {
    const entry = { ...body, seq: ++seq, at: Date.now() } as Entry;
    log.push(entry);
    if (log.length > limit) log = log.slice(-limit);
    bump();
    return entry;
  }

  // ── Client state and snapshots ────────────────────────────────────────────

  const tracked: Tracked[] = [];
  const snapshots: { seq: number; state: Record<string, unknown> }[] = [];
  const capture = () => Object.fromEntries(tracked.map(t => [t.name, t.read()]));

  /** Registers a store whose state time travel captures and restores. */
  function track<T extends object>(name: string, store: T, setStore: (fn: (draft: T) => void) => void) {
    tracked.push({
      name,
      read: () => snapshot(store),
      // Positional: a keyed reconcile refuses a root (or any object) whose id changed.
      restore: value =>
        setStore(draft => {
          reconcile(value as T, null)(draft);
        })
    });
    snapshots.push({ seq, state: capture() });
  }

  /** Records a transition that has just been applied, and snapshots tracked state. */
  function commit(source: string, name: string, payload?: unknown): Entry {
    const entry = record({ kind: "transition", source, name, payload: loggable(payload) });
    snapshots.push({ seq: entry.seq, state: capture() });
    return entry;
  }

  function stateAt(at: number): Record<string, unknown> {
    for (let i = snapshots.length - 1; i >= 0; i--) if (snapshots[i].seq <= at) return snapshots[i].state;
    return snapshots[0]?.state ?? {};
  }

  // ── Time travel ───────────────────────────────────────────────────────────

  let tape: Tape = options.script ? { kind: "script" } : { kind: "live" };
  let travelingSeq: number | null = null;
  const [travelingAt, setTravelingAt] = createSignal<number | null>(null);
  const sources: unknown[] = [];

  /** Data sources (memos, optimistic stores) to refresh when the timeline moves. */
  function refreshable(...items: unknown[]) {
    sources.push(...items);
  }
  const refreshAll = () => {
    for (const source of sources) void refresh(source as never);
  };

  /** Shows the app as it was after entry `seq`. Services replay; input is ignored. */
  function rewind(at: number) {
    tape = { kind: "replay", seq: at };
    travelingSeq = at;
    setTravelingAt(at);
    const state = stateAt(at);
    for (const t of tracked) t.restore(state[t.name]);
    refreshAll();
  }

  /** Back to the latest state, with live services. */
  function resume() {
    tape = options.script ? { kind: "script" } : { kind: "live" };
    const head = snapshots[snapshots.length - 1]?.state ?? {};
    for (const t of tracked) t.restore(head[t.name]);
    travelingSeq = null;
    setTravelingAt(null);
    refreshAll();
  }

  /** False while time traveling, so callers drop the input (and it is noted). */
  function live(what: string): boolean {
    if (travelingSeq === null) return true;
    record({ kind: "note", text: `ignored ${what} while time traveling` });
    return false;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  let actionIds = 0;
  /** Records an action's lifecycle around a promise (Solid actions return one). */
  function action<T>(name: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    const id = ++actionIds;
    record({ kind: "action", phase: "start", name, id, payload: loggable(payload) });
    return run().then(
      value => {
        record({ kind: "action", phase: "settled", name, id });
        return value;
      },
      error => {
        record({ kind: "action", phase: "failed", name, id, error: messageOf(error) });
        throw error;
      }
    );
  }

  // ── Services: recorded, replayed, scripted ────────────────────────────────

  let serviceIds = 0;
  const script: ScriptedCall[] = [];

  /** Wraps every function in a (nested) services object. */
  function services<S extends object>(target: S, prefix = ""): S {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "function")
        out[key] = (...args: unknown[]) => call(path, value as (...a: unknown[]) => unknown, args);
      else if (value && typeof value === "object") out[key] = services(value as object, path);
      else out[key] = value;
    }
    return out as S;
  }

  function call(path: string, fn: (...args: unknown[]) => unknown, args: unknown[]): unknown {
    const id = ++serviceIds;
    const key = keyOf(args);
    const result = (value: unknown, shape: "value" | "promise" | "iterable") =>
      record({ kind: "service", phase: "result", path, key, id, value, shape });
    const failure = (error: unknown) => record({ kind: "service", phase: "error", path, key, id, error: messageOf(error) });

    if (tape.kind === "replay") {
      record({ kind: "service", phase: "call", path, key, id, args: loggable(args), replayed: true });
      return replay(path, key, tape.seq);
    }
    record({ kind: "service", phase: "call", path, key, id, args: loggable(args) });
    if (tape.kind === "script") {
      return new Promise((resolve, reject) =>
        script.push({
          path,
          args,
          resolve: value => {
            result(value, "promise");
            resolve(value);
          },
          reject: error => {
            failure(error);
            reject(error);
          }
        })
      );
    }
    let out: unknown;
    try {
      out = fn(...args);
    } catch (error) {
      failure(error);
      throw error;
    }
    if (isPromiseLike(out))
      return Promise.resolve(out).then(
        value => (result(value, "promise"), value),
        error => {
          failure(error);
          throw error;
        }
      );
    if (isAsyncIterable(out)) return recordIterable(out, value => result(value, "iterable"), failure);
    result(out, "value");
    return out;
  }

  // Closing the wrapper (Solid does on re-run) closes the source too.
  async function* recordIterable(
    source: AsyncIterable<unknown>,
    onValue: (value: unknown) => void,
    onError: (error: unknown) => void
  ) {
    try {
      for await (const value of source) {
        onValue(value);
        yield value;
      }
    } catch (error) {
      onError(error);
      throw error;
    }
  }

  function replay(path: string, key: string, at: number): unknown {
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.seq > at || e.kind !== "service" || e.path !== path || e.key !== key) continue;
      if (e.phase === "result") {
        const value = e.value;
        if (e.shape === "iterable")
          return (async function* () {
            yield value;
          })();
        return e.shape === "value" ? value : Promise.resolve(value);
      }
      if (e.phase === "error") return Promise.reject(new Error(e.error));
    }
    record({ kind: "note", text: `no recording of ${path}(${key}) at #${at}` });
    return new Promise(() => {});
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function exportSession(): string {
    return JSON.stringify(
      {
        entries: log.map(e => (e.kind === "service" ? { ...e, value: loggable(e.value) } : e)),
        snapshots: snapshots.map(s => ({ seq: s.seq, state: loggable(s.state) }))
      },
      null,
      2
    );
  }

  return {
    /** The timeline, oldest first. Reactive. */
    entries: (): readonly Entry[] => {
      version();
      return log.slice();
    },
    record,
    track,
    commit,
    stateAt,
    refreshable,
    action,
    services,
    rewind,
    resume,
    live,
    /** The entry being viewed while time traveling, or null when live. Reactive. */
    travelingAt,
    exportSession,
    script: {
      enable() {
        tape = { kind: "script" };
      },
      pending: (): readonly ScriptedCall[] => script.slice(),
      take(path: string, args?: readonly unknown[]): ScriptedCall | undefined {
        const i = script.findIndex(c => c.path === path && (!args || keyOf(c.args) === keyOf(args)));
        return i < 0 ? undefined : script.splice(i, 1)[0];
      }
    }
  };
}
