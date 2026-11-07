// @solidkit/messages: the Elm loop on Solid 2, with async left in Solid.
//
//   view ──send(Msg)──▶ update(draft, msg, data) ──▶ Act[] ──▶ handlers (Solid actions)
//     ▲                     │ mutates the model store            │ optimistic writes, services,
//     │                     ▼                                    │ refresh; return a Msg on
//     └──── model + data ◀─ data(model, services): memos,        │ success, onActionError on
//                           projections, optimistic stores ◀─────┘ failure (lands with the revert)
//
// Kernel wiring (what makes time travel, devtools and scripted tests work):
// - the model store is kernel-tracked; every message is committed as a transition,
// - every requested action is recorded with kernel.action,
// - services are wrapped with kernel.services (recorded, replayed, scripted),
// - data sources named by spec.sources are kernel.refreshable,
// - input is dropped while rewound (kernel.live); results of actions that settle
//   while rewound are held and applied on resume.
import {
  action,
  createEffect,
  createMemo,
  createStore,
  onFlush,
  onSettled,
  snapshot,
  untrack
} from "solid-js";
import type { Kernel } from "@solidkit/kernel";

// ── Tagged unions: messages (facts) and actions (requested mutations) ────────

export type Tagged = { readonly type: string };
export type Send<Msg> = (msg: Msg) => void;

type Variant<U, K> = Extract<U, { type: K }>;
type Payload<M> = Omit<M, "type">;

export type Constructors<U extends Tagged> = {
  readonly [K in U["type"]]: {} extends Payload<Variant<U, K>>
    ? (payload?: Payload<Variant<U, K>>) => Variant<U, K>
    : (payload: Payload<Variant<U, K>>) => Variant<U, K>;
};

/** Typed constructors for a tagged union: `Msg.ToggledTodo({ id, completed })`. */
export function variants<U extends Tagged>(): Constructors<U> {
  // A proxy, so the union type is the only declaration. The cast is the price of
  // building a mapped type at runtime.
  return new Proxy({} as Constructors<U>, {
    get: (_, type) => (payload?: object) => ({ ...payload, type })
  });
}

/**
 * createStore's value overload takes `NoFn<T>` (T extends Function ? never : T), which
 * a generic Model can't prove. Models are plain objects, so this cast is safe.
 */
export const plain = <T extends object>(value: T) => value as T extends Function ? never : T;

// Array.isArray narrows to any[], not to readonly T[]: the casts restore what was checked.
export const toList = <T>(out: T | readonly T[] | void | null | undefined | false): readonly T[] =>
  !out ? [] : Array.isArray(out) ? (out as readonly T[]) : [out as T];

// ── Program spec ──────────────────────────────────────────────────────────────

/**
 * One handler per action type. Each runs as a Solid action (one transition):
 * optimistic writes, `yield` service calls, `refresh` data. Returning a message
 * sends it inside the transition, so it lands with the refreshed data.
 */
export type Handlers<Act extends Tagged, Msg> = {
  readonly [K in Act["type"]]: (act: Variant<Act, K>) => Generator<unknown, Msg | void, any>;
};

/** Long-lived input that produces messages. Same key after a model change: keeps running. */
export type Subscription<Msg> = {
  readonly key: string;
  readonly start: (send: Send<Msg>) => () => void;
};

export type ProgramSpec<Model extends object, Msg extends Tagged, Act extends Tagged, Data, Services, Flags = void> = {
  /** Timeline source name. */
  name: string;
  /** Client state: what the user did and chose. Server data is derived in `data`, never stored. */
  init: (flags: Flags) => Model;
  /** Mutates a draft of the model. Returns the actions to run (plain data). Never waits. */
  update: (model: Model, msg: Msg, data: Data) => Act | readonly Act[] | void;
  /** Reads derived from the model, sync or async: memos, projections, optimistic stores. */
  data?: (model: Model, services: Services) => Data;
  /** The data sources time travel refreshes (they re-derive from replayed responses). */
  sources?: (data: Data) => readonly unknown[];
  /** Mutations. Each handler runs as a Solid action. */
  actions?: (data: Data, services: Services, model: Model) => Handlers<Act, NoInfer<Msg>>;
  /** Turns a failed action into a fact, sent inside its transition (lands with the optimistic revert). */
  onActionError?: (act: Act, error: unknown) => NoInfer<Msg> | void;
  /** Keyed long-lived inputs, derived from the model. */
  subscriptions?: (model: Model) => readonly (Subscription<NoInfer<Msg>> | false | null | undefined)[];
};

export type Program<Model, Msg, Data> = {
  readonly model: Model;
  readonly data: Data;
  readonly send: Send<Msg>;
  readonly kernel: Kernel;
};

type Outcome = { readonly failed: false } | { readonly failed: true; readonly error: unknown };

/** Runs a program under the current owner. Call it in a component (or a root in tests). */
export function createProgram<Model extends object, Msg extends Tagged, Act extends Tagged, Data, Services extends object, Flags = void>(
  spec: ProgramSpec<Model, Msg, Act, Data, Services, Flags>,
  options: { kernel: Kernel; services: Services; flags: Flags }
): Program<Model, Msg, Data> {
  const { kernel } = options;
  const services = kernel.services(options.services);
  // createStore owns (and later mutates) what it is given, so hand it a fresh copy.
  const [model, setModel] = createStore<Model>(plain(structuredClone(spec.init(options.flags))));
  kernel.track(spec.name, model, setModel);
  // A spec without `data` has no derived data; its Data type is whatever it declared (unused).
  const data = spec.data ? spec.data(model, services) : (undefined as Data);
  if (spec.sources) kernel.refreshable(...spec.sources(data));

  // > 0 while a handler's code runs, i.e. inside an action's transaction.
  let handlerDepth = 0;
  const inHandler = <T>(fn: () => T): T => {
    handlerDepth++;
    try {
      return fn();
    } finally {
      handlerDepth--;
    }
  };
  const held: Msg[] = []; // results of actions that settled while rewound

  function apply(msg: Msg): readonly Act[] {
    let out = undefined as Act | readonly Act[] | void; // widened: it's assigned in the closure
    setModel(draft => {
      out = spec.update(draft, msg, data);
    });
    // Acts are plain data: never let a draft proxy escape into a handler or the log.
    return toList(out).map(act => snapshot(act));
  }

  // An action opens a transaction that owns the tick's flush, so starting one in the
  // same tick as the model write would hold that write until the action settles.
  // onFlush starts the actions right after the model write has landed.
  const runAll = (acts: readonly Act[]) => {
    if (acts.length) onFlush(() => acts.forEach(run));
  };

  function send(msg: Msg): void {
    if (handlerDepth > 0) return settleWith(msg);
    if (!kernel.live(msg.type)) return;
    const acts = apply(msg);
    kernel.commit(spec.name, msg.type, msg);
    runAll(acts);
  }

  // A message from inside an action: its write is held by the transition, so the
  // commit (the snapshot time travel restores) waits until the transition lands.
  function settleWith(msg: Msg): void {
    if (untrack(kernel.travelingAt) !== null) {
      held.push(msg);
      kernel.record({ kind: "note", text: `held ${msg.type} until resume` });
      return;
    }
    const acts = apply(msg);
    onSettled(() => {
      kernel.commit(spec.name, msg.type, msg);
      runAll(acts);
    });
  }

  createEffect(kernel.travelingAt, at => {
    if (at !== null || !held.length) return;
    for (const msg of held.splice(0)) {
      const acts = apply(msg);
      kernel.commit(spec.name, msg.type, msg);
      runAll(acts);
    }
  });

  // ── Actions ──
  const runners = new Map<string, (act: Act) => Promise<Outcome>>();
  if (spec.actions) {
    // Handlers is keyed by act type, so each entry accepts its own variant; the map
    // erases that pairing (the lookup below restores it by type).
    const handlers = spec.actions(data, services, model) as unknown as Record<
      string,
      (act: Act) => Generator<unknown, Msg | void, unknown>
    >;
    for (const [type, handle] of Object.entries(handlers))
      runners.set(
        type,
        action(function* (act: Act): Generator<unknown, Outcome, unknown> {
          return yield* drive(act, handle);
        })
      );
  }

  // Steps the handler by hand, so every slice of its code is known to run inside the
  // action (messages it causes land with the transition).
  function* drive(
    act: Act,
    handle: (act: Act) => Generator<unknown, Msg | void, unknown>
  ): Generator<unknown, Outcome, unknown> {
    let it: Generator<unknown, Msg | void, unknown> | undefined;
    let input: unknown;
    let threw = false;
    for (;;) {
      let step: IteratorResult<unknown, Msg | void>;
      try {
        step = inHandler(() => {
          it ??= handle(act);
          return threw ? it.throw(input) : it.next(input);
        });
      } catch (error) {
        const msg = inHandler(() => {
          const msg = spec.onActionError?.(act, error);
          if (msg) send(msg);
          return msg;
        });
        if (!msg) throw error;
        return { failed: true, error };
      }
      if (step.done) {
        const msg = step.value;
        if (msg) inHandler(() => send(msg));
        return { failed: false };
      }
      try {
        input = yield step.value;
        threw = false;
      } catch (error) {
        input = error;
        threw = true;
      }
    }
  }

  function run(act: Act): void {
    const runner = runners.get(act.type);
    if (!runner) throw new Error(`${spec.name}: no handler for action "${act.type}"`);
    let handled = false;
    kernel
      .action(act.type, act, () =>
        runner(act).then(outcome => {
          if (!outcome.failed) return;
          handled = true; // onActionError turned it into a message; the timeline still says "failed"
          throw outcome.error;
        })
      )
      .catch(error => {
        if (!handled) queueMicrotask(() => { throw error; });
      });
  }

  // ── Subscriptions ──
  if (spec.subscriptions) {
    const subscriptions = spec.subscriptions;
    const wanted = createMemo(
      () => subscriptions(model).filter((s): s is Subscription<Msg> => !!s),
      { equals: (a, b) => a.length === b.length && a.every((s, i) => s.key === b[i].key) }
    );
    const running = new Map<string, () => void>();
    createEffect(wanted, subs => {
      const keys = new Set(subs.map(s => s.key));
      for (const [key, stop] of running)
        if (!keys.has(key)) {
          stop();
          running.delete(key);
        }
      for (const s of subs) if (!running.has(s.key)) running.set(s.key, s.start(send));
    });
    onSettled(() => () => {
      running.forEach(stop => stop());
      running.clear();
    });
  }

  return { model, data, send, kernel };
}

// ── Components (see program.tsx) ─────────────────────────────────────────────

export { program, renderView, type View, type ProgramProps } from "./program.tsx";

// ── Subscription helpers ──────────────────────────────────────────────────────

export const onWindow = <K extends keyof WindowEventMap, Msg>(
  event: K,
  toMsg: (event: WindowEventMap[K]) => Msg | void
): Subscription<Msg> => ({
  key: `window:${event}`,
  start: send => {
    const listener = (e: WindowEventMap[K]) => {
      const msg = toMsg(e);
      if (msg) send(msg);
    };
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }
});

export const every = <Msg>(ms: number, toMsg: () => Msg): Subscription<Msg> => ({
  key: `every:${ms}`,
  start: send => {
    const id = setInterval(() => send(toMsg()), ms);
    return () => clearInterval(id);
  }
});

/** Back/forward: the URL changed under the app. */
export const onUrlChange = <Msg>(toMsg: (url: URL) => Msg): Subscription<Msg> => ({
  key: "url:change",
  start: send => {
    const listener = () => send(toMsg(new URL(location.href)));
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }
});

/** A plain left click on a same-origin link becomes a message instead of a page load. */
export const onUrlRequest = <Msg>(toMsg: (url: URL) => Msg): Subscription<Msg> => ({
  key: "url:request",
  start: send => {
    const listener = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a") : null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      e.preventDefault();
      send(toMsg(new URL(a.href)));
    };
    document.addEventListener("click", listener);
    return () => document.removeEventListener("click", listener);
  }
});

/** Hover, focus or touch on a same-origin link: the user may follow it (for preloading). */
export const onLinkIntent = <Msg>(toMsg: (url: URL) => Msg): Subscription<Msg> => ({
  key: "url:intent",
  start: send => {
    let last = "";
    const listener = (e: Event) => {
      const a = e.target instanceof Element ? e.target.closest("a") : null;
      if (!a || a.target || a.origin !== location.origin || a.href === last) return;
      last = a.href; // once per link, not once per mouse move
      send(toMsg(new URL(a.href)));
    };
    const types = ["mouseover", "focusin", "touchstart"] as const;
    for (const type of types) document.addEventListener(type, listener, { passive: true });
    return () => {
      for (const type of types) document.removeEventListener(type, listener);
    };
  }
});
