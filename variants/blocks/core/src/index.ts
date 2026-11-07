// @solidkit/blocks: Elm-style messages with Foldkit-style composition, on Solid 2.
//
// A block bundles one feature: its model, messages, update, derived data,
// action handlers, view, public operations, out-messages and the services it
// requires. Parents connect children with bindings in `children`:
//
//   - the child's model lives in a field of the parent's model (`field`) or in a
//     keyed record (`keyed`), so the whole app is one store and one timeline;
//   - child messages are routed automatically (no wrapper messages in the
//     parent's union); the child's update runs on its slice of the draft;
//   - a parent changes a child only through the child's operations (which are
//     messages), and hears from it only through out-messages it must fold;
//   - keyed instances (their data, actions, subscriptions) are disposed when
//     their key leaves the record or their owner is disposed;
//   - required services are flat maps, checked by type at each binding and at
//     run time when the app is assembled.
//
// Async stays in Solid: `data` returns memos/optimistic stores, handlers are
// Solid actions. The kernel (@solidkit/kernel) records every transition with
// the block path as its source, every action and every service call.
import { action, createComponent, createEffect, createMemo, createRoot, createStore, flush, getOwner, merge, onCleanup, onSettled, runWithOwner, snapshot, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Kernel } from "@solidkit/kernel";

// ── Messages ────────────────────────────────────────────────────────────────

export type Tagged = { readonly type: string };
export type Send<M> = (msg: M) => void;
/** What update returns: the action requests to run (none, one or several). */
export type Acts<A> = A | readonly A[] | void | undefined | null | false;

type Variant<U, K> = Extract<U, { type: K }>;
type Payload<M> = Omit<M, "type">;
export type Constructors<U extends Tagged> = {
  readonly [K in U["type"]]: {} extends Payload<Variant<U, K>>
    ? (payload?: Payload<Variant<U, K>>) => Variant<U, K>
    : (payload: Payload<Variant<U, K>>) => Variant<U, K>;
};

/** Typed constructors for a tagged union: `Msg.Toggled({ id })`. */
export function variants<U extends Tagged>(): Constructors<U> {
  return new Proxy({} as Constructors<U>, {
    get: (_, type) => (payload?: object) => ({ ...payload, type })
  });
}

export const toList = <T>(out: Acts<T>): readonly T[] =>
  out === undefined || out === null || out === false ? [] : Array.isArray(out) ? (out as readonly T[]) : [out as T];

// ── Block types ─────────────────────────────────────────────────────────────

/**
 * The type bag a block declares once. `model` includes the fields its
 * children live in. Everything but `model` and `msg` is optional.
 */
export type Types = {
  model: object;
  msg: Tagged;
  /** Action requests (mutations) update may return. */
  act?: Tagged;
  /** Facts this block reports to its parent. */
  out?: Tagged;
  /** Services this block needs: a flat map, e.g. `{ api: TodoApi }`. */
  services?: object;
  /** Arguments to init. */
  args?: unknown;
  /** Extra props the parent passes when it renders this block's view. */
  inputs?: object;
};

export type ActOf<T> = T extends { act: infer A extends Tagged } ? A : never;
export type OutOf<T> = T extends { out: infer O extends Tagged } ? O : never;
export type ServicesOf<T> = T extends { services: infer S extends object } ? S : {};
export type ArgsOf<T> = T extends { args: infer A } ? A : void;
export type InputsOf<T> = T extends { inputs: infer I extends object } ? I : {};

/** Public operations: the only way a parent changes a child. Each returns one of the child's messages. */
export type Operations<Msg> = { readonly [name: string]: (...args: any[]) => Msg };

/** One action handler: a generator run as a Solid action (yield promises, write optimistically, refresh). */
export type Handler<A> = (act: A) => Generator<unknown, unknown, any>;

/** What a driver returns: a Solid action (call it to run) that may also be interruptible. */
export type DrivenAction<A> = ((act: A) => Promise<unknown>) & { interrupt?: () => void };

/** A handler run by another action driver, e.g. effectAction (its generator yields Effects). */
export interface Driven<A> {
  readonly kind: "driven";
  readonly handler: Handler<A>;
  readonly drive: (handler: Handler<A>) => DrivenAction<A>;
}

/** Runs `handler` with `drive` instead of Solid's `action`. The block still records it, tracks its steps and maps its errors. */
export function driven<A, G extends Handler<A>>(drive: (handler: G) => DrivenAction<A>, handler: G): Driven<A> {
  // `drive` is given a wrapper with the same generator protocol as `handler` (see createInstance).
  return { kind: "driven", handler, drive: drive as (handler: Handler<A>) => DrivenAction<A> };
}

export type Handlers<A extends Tagged> = { readonly [K in A["type"]]: Handler<Variant<A, K>> | Driven<Variant<A, K>> };

/** Long-lived input that produces messages. Same key after a change: it keeps running. */
export type Subscription<Msg> = {
  readonly key: string;
  readonly start: (send: Send<Msg>) => () => void;
};

export interface Block<T extends Types, C, Data, Ops> {
  readonly name: string;
  /** The spec as written. Typed through `types` only, which keeps block types shallow. */
  readonly spec: unknown;
  readonly operations: Ops;
  /** Phantom, never set: carries the block's types for bindings and handles. */
  readonly types?: { readonly t: T; readonly c: C; readonly data: Data; readonly ops: Ops };
}
// `any` here is the usual "some block" existential; concrete types flow through inference.
export type AnyBlock = Block<any, any, any, any>;
export type TypesOf<B> = B extends Block<infer T, any, any, any> ? T : never;
export type ModelOf<B> = TypesOf<B>["model"];
export type MsgOf<B> = TypesOf<B>["msg"];
export type DataOf<B> = B extends Block<any, any, infer D, any> ? D : never;
export type OpsOf<B> = B extends Block<any, any, any, infer O> ? O : never;

// ── Bindings ────────────────────────────────────────────────────────────────

/** A child stored in one field of the parent's model. */
export interface FieldBinding<B extends AnyBlock> {
  readonly kind: "field";
  readonly block: B;
  readonly init?: (parentArgs: any) => ArgsOf<TypesOf<B>>;
  /** Phantom: what the parent's field must hold. */
  readonly slot?: ModelOf<B>;
  /** Phantom, contravariant: the parent's services must cover the child's. */
  readonly needs?: (services: ServicesOf<TypesOf<B>>) => void;
}

/** Children stored in a record keyed by id in one field of the parent's model. */
export interface KeyedBinding<B extends AnyBlock> {
  readonly kind: "keyed";
  readonly block: B;
  readonly initial?: (parentArgs: any) => Record<string, ArgsOf<TypesOf<B>>>;
  readonly slot?: Record<string, ModelOf<B>>;
  readonly needs?: (services: ServicesOf<TypesOf<B>>) => void;
}

export type AnyBinding = FieldBinding<AnyBlock> | KeyedBinding<AnyBlock>;

/** Binds a child to a field of the parent's model. `init` maps the parent's init args to the child's. */
export function field<B extends AnyBlock>(block: B, options: { init?: (parentArgs: any) => ArgsOf<TypesOf<B>> } = {}): FieldBinding<B> {
  return { kind: "field", block, init: options.init };
}

/** Binds a keyed collection of children to a `Record<string, ChildModel>` field. */
export function keyed<B extends AnyBlock>(block: B, options: { initial?: (parentArgs: any) => Record<string, ArgsOf<TypesOf<B>>> } = {}): KeyedBinding<B> {
  return { kind: "keyed", block, initial: options.initial };
}

/** Shallow, one level: binding names are model fields, slots match, services are covered. */
export type ChildrenOf<T extends Types> = {
  readonly [K in keyof T["model"]]?: {
    readonly kind: "field" | "keyed";
    readonly block: AnyBlock;
    readonly slot?: T["model"][K];
    readonly needs?: (services: ServicesOf<T>) => void;
  };
};

type BlockOf<Bn> = Bn extends { readonly block: infer B extends AnyBlock } ? B : never;
type ChildOut<Bn> = OutOf<TypesOf<BlockOf<Bn>>>;

/** Calling an operation through a handle delivers its message to the child. */
export type OpsHandle<B> = { readonly [K in keyof OpsOf<B>]: OpsOf<B>[K] extends (...args: infer P) => any ? (...args: P) => void : never };
export type KeyedHandle<B extends AnyBlock> = {
  /** Operations of the instance at `key`. */
  at(key: string): OpsHandle<B>;
  /** Adds an instance (written into the parent's draft now). */
  insert(key: string, ...args: ArgsOf<TypesOf<B>> extends void ? [] : [args: ArgsOf<TypesOf<B>>]): void;
  /** Removes an instance; its data, actions and subscriptions are disposed. */
  remove(key: string): void;
  has(key: string): boolean;
};
export type Handles<C> = {
  readonly [K in keyof C]: C[K] extends KeyedBinding<infer B> ? KeyedHandle<B> : C[K] extends FieldBinding<infer B> ? OpsHandle<B> : never;
};

/** Child views, ready to render: `<props.blocks.list />`, `<props.blocks.items key={id} />`. */
export type Views<C> = {
  readonly [K in keyof C]: C[K] extends KeyedBinding<infer B>
    ? (props: { key: string } & InputsOf<TypesOf<B>>) => JSX.Element
    : C[K] extends FieldBinding<infer B>
      ? (props: InputsOf<TypesOf<B>>) => JSX.Element
      : never;
};

// ── Block spec ──────────────────────────────────────────────────────────────

export interface UpdateCtx<T extends Types, C, Data> {
  /** This block's derived data (read it; don't write it here). */
  readonly data: Data;
  /** Children's operations (and insert/remove for keyed children). */
  readonly blocks: Handles<C>;
  /** Reports a fact to the parent, which folds it. */
  emit(out: OutOf<T>): void;
  /** This instance's key, for keyed children. */
  readonly key: string | undefined;
}

export interface DataCtx {
  /** Registers sources the kernel refreshes when the timeline moves; returns the first. */
  refreshable<S>(source: S, ...more: unknown[]): S;
  readonly path: string;
  readonly key: string | undefined;
}

export interface ActionCtx<T extends Types> {
  /** Sends a message from inside the action; it lands with the action's transition. */
  readonly send: Send<T["msg"]>;
  /** Interrupts the in-flight run of a driven action that supports it (e.g. effectAction). */
  interrupt(type: ActOf<T>["type"]): void;
  readonly path: string;
}

export type ViewProps<T extends Types, C, Data> = {
  readonly model: T["model"];
  readonly send: Send<T["msg"]>;
  readonly data: Data;
  readonly blocks: Views<C>;
} & InputsOf<T>;

/** For each child with out-messages, one handler per out-message: the parent's reaction, run as its own transition. */
export type OutPolicies<T extends Types, C, Data> = {
  readonly [K in keyof C as ChildOut<C[K]> extends never ? never : K]: {
    readonly [O in ChildOut<C[K]>["type"]]: (
      out: Variant<ChildOut<C[K]>, O>,
      model: T["model"],
      ctx: UpdateCtx<T, C, Data>,
      key: string | undefined
    ) => Acts<ActOf<T>>;
  };
};

export interface BaseSpec<T extends Types, C, Data, Ops> {
  readonly name: string;
  /** Every service in `T["services"]`, listed so assembly can check them at run time. */
  readonly requires: { readonly [K in keyof ServicesOf<T>]-?: true };
  readonly children?: C;
  /** The block's own fields; bindings fill the children's. */
  readonly init: (args: ArgsOf<T>) => Omit<T["model"], keyof C>;
  /** Derived reads (async memos, optimistic stores). Server data lives here, not in the model. */
  readonly data?: (model: T["model"], services: ServicesOf<T>, ctx: DataCtx) => Data;
  /** Mutates a draft of this block's model. Returns action requests. Never waits. */
  readonly update: (model: T["model"], msg: T["msg"], ctx: UpdateCtx<T, C, Data>) => Acts<ActOf<T>>;
  /** Solid action bodies, one per action type. */
  readonly actions?: (data: Data, services: ServicesOf<T>, ctx: ActionCtx<T>) => Handlers<ActOf<T>>;
  /** Turns a failed action into a message, applied inside the action's transition. Return nothing to rethrow. */
  readonly onActionError?: (act: ActOf<T>, error: unknown) => T["msg"] | void;
  readonly subscriptions?: (model: T["model"], data: Data) => readonly (Subscription<T["msg"]> | false | null | undefined)[];
  readonly operations?: Ops;
  readonly view?: (props: ViewProps<T, C, Data>) => JSX.Element;
}

/** `out` is required exactly when some child has out-messages, and must handle each one. */
export type BlockSpec<T extends Types, C, Data, Ops> = BaseSpec<T, C, Data, Ops> &
  (keyof OutPolicies<T, C, Data> extends never ? { readonly out?: undefined } : { readonly out: OutPolicies<T, C, Data> });

/**
 * Defines a block. Declare the type bag first, then the spec:
 * `block<{ model: Model; msg: Msg; act: Act }>()({ name, requires, init, update, ... })`.
 */
export function block<T extends Types>() {
  return <C extends ChildrenOf<T> = {}, Data = undefined, Ops extends Operations<T["msg"]> = {}>(
    spec: BlockSpec<T, C, Data, Ops>
  ): Block<T, C, Data, Ops> => ({ name: spec.name, spec, operations: (spec.operations ?? {}) as Ops });
}

// ── Runtime ─────────────────────────────────────────────────────────────────

type Segment = { readonly field: string; readonly key?: string };
type Loose = Record<string, any>;
type AnySpec = BaseSpec<any, Record<string, AnyBinding>, any, Operations<Tagged>> & { out?: Record<string, Record<string, Function>> };
// The one structural cast: a spec was checked against its own types by block(); the runtime reads it loosely.
const specOf = (b: AnyBlock) => b.spec as AnySpec;

type Job = {
  target: () => Instance | undefined;
  path: string;
  name: string;
  payload: unknown;
  apply: (model: Loose, ctx: UpdateCtx<any, any, any>) => Acts<Tagged>;
};

interface App {
  readonly kernel: Kernel;
  readonly services: Loose;
  readonly store: Loose;
  readonly setStore: (fn: (draft: Loose) => void) => void;
  readonly queue: Job[];
  draining: boolean;
}

/** One live block: a root scope owning its data, actions, subscriptions and children. */
export interface Instance {
  readonly path: string;
  readonly block: AnyBlock;
  readonly key: string | undefined;
  readonly binding: string | undefined;
  readonly parent: Instance | undefined;
  readonly segments: readonly Segment[];
  readonly model: Loose;
  readonly data: unknown;
  readonly fields: Map<string, Instance>;
  readonly keyed: Map<string, KeyedSet>;
  readonly views: Loose;
  readonly View: (inputs: Loose) => JSX.Element;
  /** Input from the view or a subscription: ignored while time traveling. */
  send(msg: Tagged): void;
  run(act: Tagged): void;
  dispose(): void;
  disposed: boolean;
}

interface KeyedSet {
  get(key: string): Instance | undefined;
  readonly instances: Map<string, Instance>;
}

function walk(root: unknown, segments: readonly Segment[]): Loose | undefined {
  let node = root as Loose | undefined;
  for (const s of segments) {
    node = node?.[s.field];
    if (s.key !== undefined) node = node?.[s.key];
  }
  return node ?? undefined;
}

/** A stable object whose reads go to wherever the instance's model is now (time travel may move it). */
function lens(get: () => Loose | undefined): Loose {
  return new Proxy({} as Loose, {
    get: (_, p) => get()?.[p as string],
    has: (_, p) => {
      const t = get();
      return !!t && p in t;
    },
    ownKeys: () => {
      const t = get();
      return t ? Reflect.ownKeys(t) : [];
    },
    getOwnPropertyDescriptor: (_, p) => {
      const t = get();
      const d = t && Reflect.getOwnPropertyDescriptor(t, p);
      return d ? { ...d, configurable: true } : undefined;
    }
  });
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An action error that onActionError turned into a message: recorded as failed, not rethrown. */
class HandledActionError extends Error {
  constructor(readonly original: unknown) {
    super(messageOf(original));
  }
}

// Depth of action generator steps currently executing. Messages sent inside a
// step are applied at once (so their writes join the action's transition) and
// committed when that transition lands: a snapshot taken mid-transition would
// not show them yet.
let stepDepth = 0;
function stepTracked(handler: Handler<any>): (act: any) => Generator<unknown, unknown, unknown> {
  return function* (act: unknown) {
    const it = handler(act);
    let input: unknown;
    let error: unknown;
    let threw = false;
    for (;;) {
      let step: IteratorResult<unknown, unknown>;
      stepDepth++;
      try {
        step = threw ? it.throw(error) : it.next(input);
      } finally {
        stepDepth--;
      }
      if (step.done) return step.value;
      threw = false;
      try {
        input = yield step.value;
      } catch (e) {
        error = e;
        threw = true;
      }
    }
  };
}

type Started = readonly [Instance, Tagged];

// Elm order: every update of one dispatch cycle (the message, the operations
// it calls, the folds of its out-messages) is applied first, then the action
// requests run. The writes are flushed before the actions start: Solid holds a
// write made in the same tick as an action's start until that action settles.
function dispatch(app: App, job: Job) {
  if (stepDepth > 0) {
    for (const [inst, act] of process(app, job, true)) inst.run(act);
    return;
  }
  app.queue.push(job);
  if (app.draining) return;
  app.draining = true;
  const acts: Started[] = [];
  try {
    while (app.queue.length) acts.push(...process(app, app.queue.shift()!, false));
  } finally {
    app.draining = false;
  }
  if (!acts.length) return;
  flush();
  for (const [inst, act] of acts) inst.run(act);
}

function process(app: App, job: Job, inStep: boolean): Started[] {
  const inst = job.target();
  if (!inst || inst.disposed) {
    app.kernel.record({ kind: "note", text: `dropped ${job.name}: ${job.path} is gone` });
    return [];
  }
  const outs: Tagged[] = [];
  const ops: Job[] = [];
  let acts: Acts<Tagged>;
  let found = false;
  app.setStore(root => {
    const model = walk(root, inst.segments);
    if (!model) return;
    found = true;
    acts = job.apply(model, updateCtx(app, inst, model, outs, ops));
  });
  if (!found) {
    app.kernel.record({ kind: "note", text: `dropped ${job.name}: no model at ${inst.path}` });
    return [];
  }
  if (inStep)
    onSettled(() => {
      app.kernel.commit(inst.path, job.name, job.payload);
    });
  else app.kernel.commit(inst.path, job.name, job.payload);
  for (const op of ops) dispatch(app, op);
  for (const out of outs) routeOut(app, inst, out);
  return toList(acts).map(act => [inst, act] as const);
}

function updateCtx(app: App, inst: Instance, draft: Loose, outs: Tagged[], ops: Job[]): UpdateCtx<any, any, any> {
  const children = specOf(inst.block).children ?? {};
  const opsHandle = (child: AnyBlock, target: () => Instance | undefined, path: string) =>
    new Proxy({} as Loose, {
      get: (_, op: string) => (...args: unknown[]) => {
        const make = specOf(child).operations?.[op];
        if (!make) throw new Error(`${child.name} has no operation "${op}"`);
        const msg = make(...args);
        ops.push({ target, path, name: msg.type, payload: { ...msg, via: `${op}() from ${inst.path}` }, apply: (m, c) => specOf(child).update(m, msg, c) });
      }
    });
  const blocks: Loose = {};
  for (const [name, binding] of Object.entries(children)) {
    if (binding.kind === "field") {
      blocks[name] = opsHandle(binding.block, () => inst.fields.get(name), `${inst.path}/${name}`);
    } else {
      blocks[name] = {
        at: (key: string) => opsHandle(binding.block, () => inst.keyed.get(name)?.get(key), `${inst.path}/${name}[${key}]`),
        insert: (key: string, args?: unknown) => {
          draft[name] ??= {};
          draft[name][key] = initModel(binding.block, args);
        },
        remove: (key: string) => {
          if (draft[name]) delete draft[name][key];
        },
        has: (key: string) => !!draft[name] && key in draft[name]
      };
    }
  }
  return { data: inst.data, blocks: blocks as never, emit: out => void outs.push(out), key: inst.key };
}

function routeOut(app: App, child: Instance, out: Tagged) {
  const parent = child.parent;
  const fold = parent && child.binding ? specOf(parent.block).out?.[child.binding]?.[out.type] : undefined;
  if (!parent || !fold) {
    app.kernel.record({ kind: "note", text: `unhandled out-message ${out.type} from ${child.path}` });
    return;
  }
  const from = child.key === undefined ? child.binding : `${child.binding}[${child.key}]`;
  dispatch(app, {
    target: () => parent,
    path: parent.path,
    name: `${from}.${out.type}`,
    payload: out,
    apply: (m, c) => fold(out, m, c, child.key)
  });
}

/** Builds a block's initial model: its own fields from init, its children's from their bindings. */
export function initModel(b: AnyBlock, args?: unknown): Loose {
  const spec = specOf(b);
  const model: Loose = { ...spec.init(args) };
  for (const [name, binding] of Object.entries(spec.children ?? {})) {
    if (binding.kind === "field") model[name] = initModel(binding.block, binding.init?.(args));
    else
      model[name] = Object.fromEntries(
        Object.entries(binding.initial?.(args) ?? {}).map(([key, a]) => [key, initModel(binding.block, a)])
      );
  }
  return model;
}

/** Every missing service, with the block path that needs it. */
export function missingServices(b: AnyBlock, services: object, path = b.name): string[] {
  const spec = specOf(b);
  const missing = Object.keys(spec.requires ?? {})
    .filter(key => !(key in services))
    .map(key => `${key} (needed by ${path})`);
  for (const [name, binding] of Object.entries(spec.children ?? {}))
    missing.push(...missingServices(binding.block, services, `${path}/${name}${binding.kind === "keyed" ? "[*]" : ""}`));
  return missing;
}

function createInstance(app: App, b: AnyBlock, path: string, segments: readonly Segment[], parent?: Instance, binding?: string, key?: string): Instance {
  return createRoot(dispose => {
    const spec = specOf(b);
    const services: Loose = {};
    for (const name of Object.keys(spec.requires ?? {})) services[name] = app.services[name];
    const fields = new Map<string, Instance>();
    const keyedSets = new Map<string, KeyedSet>();
    const views: Loose = {};

    const inst: Instance = {
      path,
      block: b,
      key,
      binding,
      parent,
      segments,
      model: lens(() => walk(app.store, segments)),
      data: undefined,
      fields,
      keyed: keyedSets,
      views,
      View: inputs => (spec.view ? createComponent(spec.view, merge({ model: inst.model, send: inst.send, data: inst.data, blocks: views }, inputs) as never) : null),
      send(msg) {
        if (!app.kernel.live(`${msg.type} for ${path}`)) return;
        deliver(msg);
      },
      run: act => void runAct(act),
      dispose,
      disposed: false
    };
    onCleanup(() => {
      inst.disposed = true;
    });
    const deliver = (msg: Tagged) =>
      dispatch(app, { target: () => inst, path, name: msg.type, payload: msg, apply: (m, c) => spec.update(m, msg, c) });

    // Children first: a parent's view renders them; their scopes are owned by this one.
    for (const [name, child] of Object.entries(spec.children ?? {})) {
      if (child.kind === "field") {
        const c = createInstance(app, child.block, `${path}/${name}`, [...segments, { field: name }], inst, name);
        fields.set(name, c);
        views[name] = (inputs: Loose) => c.View(inputs);
      } else {
        const set = keyedSet(app, inst, name, child.block);
        keyedSets.set(name, set);
        views[name] = (inputs: { key: string }) => {
          // A mounted view shows one instance: the key is read once (render it under a keyed <For>).
          const c = set.get(untrack(() => inputs.key, false));
          return c ? c.View(inputs) : null;
        };
      }
    }

    const dataCtx: DataCtx = {
      refreshable: (source, ...more) => {
        app.kernel.refreshable(source, ...more);
        return source;
      },
      path,
      key
    };
    (inst as { data: unknown }).data = spec.data ? spec.data(inst.model, services, dataCtx) : undefined;

    // Actions: each handler becomes a Solid action, recorded by the kernel.
    const runners = new Map<string, DrivenAction<Tagged>>();
    const handlers: Loose = spec.actions
      ? spec.actions(inst.data, services, { send: msg => fromAction(msg), interrupt: type => runners.get(type)?.interrupt?.(), path })
      : {};
    for (const [type, h] of Object.entries(handlers) as [string, Handler<Tagged> | Driven<Tagged>][]) {
      const isDriven = typeof h !== "function";
      const tracked = stepTracked(isDriven ? h.handler : h);
      const body = function* (act: Tagged): Generator<unknown, unknown, unknown> {
        try {
          return yield* tracked(act);
        } catch (error) {
          const msg = spec.onActionError?.(act, error);
          if (msg === undefined) throw error;
          stepDepth++; // the catch runs inside the action's step
          try {
            fromAction(msg);
          } finally {
            stepDepth--;
          }
          return new HandledActionError(error);
        }
      };
      runners.set(type, isDriven ? h.drive(body) : action(body));
    }
    function fromAction(msg: Tagged) {
      if (inst.disposed || !app.kernel.live(`${msg.type} from an action of ${path}`)) return;
      deliver(msg);
    }
    function runAct(act: Tagged) {
      const runner = runners.get(act.type);
      if (!runner) throw new Error(`${path}: no handler for action "${act.type}"`);
      return app.kernel
        .action(`${path}:${act.type}`, act, () =>
          runner(act).then(result => {
            if (result instanceof HandledActionError) throw result;
            return result;
          })
        )
        .catch(error => {
          if (error instanceof HandledActionError) return;
          queueMicrotask(() => {
            throw error;
          });
        });
    }

    // Subscriptions: started and stopped by key as the model changes.
    if (spec.subscriptions) {
      const subscriptions = spec.subscriptions;
      const wanted = createMemo(() => subscriptions(inst.model, inst.data).filter((s): s is Subscription<Tagged> => !!s), {
        equals: (a, b) => a.length === b.length && a.every((s, i) => s.key === b[i].key)
      });
      const running = new Map<string, () => void>();
      createEffect(wanted, subs => {
        const keys = new Set(subs.map(s => s.key));
        for (const [k, stop] of running)
          if (!keys.has(k)) {
            stop();
            running.delete(k);
          }
        for (const s of subs) if (!running.has(s.key)) running.set(s.key, s.start(msg => inst.send(msg)));
      });
      onSettled(() => () => running.forEach(stop => stop()));
    }
    return inst;
  });
}

function keyedSet(app: App, parent: Instance, name: string, child: AnyBlock): KeyedSet {
  const owner = getOwner();
  const instances = new Map<string, Instance>();
  const collection = [...parent.segments, { field: name }];
  const get = (key: string) => {
    let inst = instances.get(key);
    if (inst && !inst.disposed) return inst;
    if (!untrack(() => walk(app.store, [...collection, { field: key }]))) return undefined;
    inst = runWithOwner(owner, () => createInstance(app, child, `${parent.path}/${name}[${key}]`, [...collection.slice(0, -1), { field: name, key }], parent, name, key));
    instances.set(key, inst);
    return inst;
  };
  // Keys come and go with the model (updates, time travel): create and dispose instances to match.
  createEffect(
    () => Object.keys(walk(app.store, collection) ?? {}),
    keys => {
      const live = new Set(keys);
      for (const [key, inst] of instances)
        if (!live.has(key)) {
          inst.dispose();
          instances.delete(key);
        }
      for (const key of keys) get(key);
    }
  );
  return { get, instances };
}

// ── Services ────────────────────────────────────────────────────────────────

const isAsyncIterable = (v: unknown): v is AsyncIterable<unknown> =>
  !!v && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";

function mapFunctions(target: Loose, map: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown): Loose {
  const out: Loose = {};
  for (const [key, value] of Object.entries(target))
    out[key] = typeof value === "function" ? map(value as (...args: unknown[]) => unknown) : value && typeof value === "object" ? mapFunctions(value, map) : value;
  return out;
}

/**
 * Wraps services with kernel.services (recorded, replayed, scripted), and makes
 * closing a recorded AsyncIterable close its source at once. The kernel's
 * recorder is an async generator, whose return() waits for the pending next()
 * to settle, so a superseded flight (an Effect fiber, a stream) would run to
 * completion. Here the source iterator is remembered below the kernel and
 * closed directly when Solid closes the recorded one.
 */
function recordServices(kernel: Kernel, raw: Loose): Loose {
  let opened: { iterator?: AsyncIterator<unknown> } | undefined;
  const take = () => {
    const handle = opened;
    opened = undefined;
    return handle;
  };
  const below = mapFunctions(raw, fn => (...args) => {
    const out = fn(...args);
    if (!isAsyncIterable(out)) return out;
    const handle: { iterator?: AsyncIterator<unknown> } = {};
    opened = handle;
    return {
      [Symbol.asyncIterator]() {
        return (handle.iterator = out[Symbol.asyncIterator]());
      }
    };
  });
  const recorded = kernel.services(below);
  return mapFunctions(recorded, fn => (...args) => {
    take();
    const out = fn(...args);
    const source = take(); // set below the kernel during this call (live calls only)
    if (!source || !isAsyncIterable(out)) return out;
    return {
      [Symbol.asyncIterator]() {
        const it = out[Symbol.asyncIterator]();
        return {
          next: (value?: unknown) => it.next(value),
          return(value?: unknown) {
            void source.iterator?.return?.();
            return it.return ? it.return(value) : Promise.resolve({ done: true as const, value: undefined });
          }
        };
      }
    };
  });
}

// ── Running an app (or any block on its own) ────────────────────────────────

export interface BlockHandle<B extends AnyBlock = AnyBlock> {
  readonly path: string;
  readonly model: ModelOf<B>;
  readonly data: DataOf<B>;
  /** Sends a message as input (ignored while time traveling). */
  send(msg: MsgOf<B>): void;
  /** A plain copy of this block's state now, or after timeline entry `seq`. */
  state(seq?: number): ModelOf<B> | undefined;
}

export interface Running<B extends AnyBlock> extends BlockHandle<B> {
  readonly kernel: Kernel;
  readonly View: () => JSX.Element;
  /**
   * A handle on a descendant by path relative to the root ("list", "pages/story[42]").
   * The type parameter is a claim, not checked against the path.
   */
  at<C extends AnyBlock = AnyBlock>(path: string): BlockHandle<C>;
  dispose(): void;
}

export interface RunOptions<B extends AnyBlock> {
  readonly kernel: Kernel;
  /** Raw services; they are wrapped with kernel.services so every call is recorded and replayable. */
  readonly services: ServicesOf<TypesOf<B>>;
  readonly args?: ArgsOf<TypesOf<B>>;
  /** Root path and kernel track name (default: the block's name). */
  readonly name?: string;
}

/**
 * Assembles and starts a block as the root of an app: checks services, creates
 * the one store (tracked by the kernel), and every instance. Call under an owner
 * (a component, or createRoot in tests).
 */
export function run<B extends AnyBlock>(root: B, options: RunOptions<B>): Running<B> {
  const name = options.name ?? root.name;
  const missing = missingServices(root, options.services as object, name);
  if (missing.length) throw new Error(`Missing services: ${missing.join(", ")}`);
  const kernel = options.kernel;
  const [store, setStore] = createStore<Loose>(initModel(root, options.args));
  kernel.track(name, store, setStore);
  const app: App = { kernel, services: recordServices(kernel, options.services as Loose), store, setStore, queue: [], draining: false };
  kernel.commit(name, "init", options.args);
  const inst = createInstance(app, root, name, []);

  const handle = (i: Instance | undefined, path: string): BlockHandle<AnyBlock> => ({
    path,
    get model() {
      return i?.model;
    },
    get data() {
      return i?.data;
    },
    send: msg => (i ? i.send(msg) : kernel.record({ kind: "note", text: `no block at ${path}` })),
    state: seq => {
      const state = seq === undefined ? snapshot(store) : kernel.stateAt(seq)[name];
      return i ? walk(state, i.segments) : undefined;
    }
  });
  const find = (path: string) => {
    let node: Instance | undefined = inst;
    for (const part of path.split("/").filter(Boolean)) {
      const open = part.indexOf("[");
      node = open < 0 ? node?.fields.get(part) : node?.keyed.get(part.slice(0, open))?.get(part.slice(open + 1, -1));
    }
    return node;
  };
  return {
    ...handle(inst, name),
    get model() {
      return store as ModelOf<B>;
    },
    get data() {
      return inst.data as DataOf<B>;
    },
    kernel,
    View: () => inst.View({}),
    at: path => handle(find(path), `${name}/${path}`),
    dispose: () => inst.dispose()
  };
}
