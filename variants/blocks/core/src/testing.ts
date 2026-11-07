// @solidkit/blocks/testing: pure update tests and scripted scenario runs.
import { createRoot } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel, type Kernel } from "@solidkit/kernel";
import { scripted, settled } from "@solidkit/kernel/testing";
import { run, toList, type AnyBlock, type ArgsOf, type DataOf, type ModelOf, type MsgOf, type Running, type ServicesOf, type Tagged, type TypesOf } from "./index.ts";

export { scripted, settled };

// happy-dom drops `el.textContent = 0` (no text node is created), so Solid's
// later in-place update of a rendered 0 throws and halts reactivity. Tests
// import this module, so patch the setter here, only when the bug is present.
if (typeof document !== "undefined") {
  const probe = document.createElement("span");
  (probe as { textContent: unknown }).textContent = 0;
  if (probe.childNodes.length === 0)
    for (const proto of [Element.prototype, Node.prototype]) {
      const d = Object.getOwnPropertyDescriptor(proto, "textContent");
      if (d?.set) {
        const set = d.set;
        Object.defineProperty(proto, "textContent", {
          ...d,
          set(value: unknown) {
            set.call(this, typeof value === "number" ? String(value) : value);
          }
        });
      }
    }
}

/** What an update asked for, besides changing the model. */
export type Recorded = {
  /** Action requests returned by update. */
  readonly acts: readonly Tagged[];
  /** Out-messages emitted to the parent. */
  readonly outs: readonly Tagged[];
  /** Child operations called: `{ block: "list", key?, op: "add", args: [...] }`. */
  readonly ops: readonly { block: string; key?: string; op: string; args: unknown[] }[];
};

type Loose = Record<string, any>;
// Block internals, read loosely: tests reach into specs on purpose.
const specOf = (b: AnyBlock) => b.spec as Loose;

function recordingCtx(b: AnyBlock, draft: Loose, data: unknown, key: string | undefined) {
  const outs: Tagged[] = [];
  const ops: { block: string; key?: string; op: string; args: unknown[] }[] = [];
  const recorder = (name: string, k?: string) =>
    new Proxy({} as Loose, { get: (_, op: string) => (...args: unknown[]) => void ops.push({ block: name, ...(k === undefined ? {} : { key: k }), op, args }) });
  const blocks: Loose = {};
  for (const [name, binding] of Object.entries(specOf(b).children ?? {}) as [string, Loose][]) {
    blocks[name] =
      binding.kind === "field"
        ? recorder(name)
        : {
            at: (k: string) => recorder(name, k),
            insert: (k: string, args?: unknown) => {
              draft[name] ??= {};
              draft[name][k] = { ...specOf(binding.block).init(args) };
              ops.push({ block: name, key: k, op: "insert", args: args === undefined ? [] : [args] });
            },
            remove: (k: string) => {
              if (draft[name]) delete draft[name][k];
              ops.push({ block: name, key: k, op: "remove", args: [] });
            },
            has: (k: string) => !!draft[name] && k in draft[name]
          };
  }
  return { ctx: { data, blocks, emit: (out: Tagged) => void outs.push(out), key }, outs, ops };
}

/**
 * Pure: runs one update on a copy of `model` and returns the new model and what
 * it asked for. `data` stands in for the block's data: pass only what update reads.
 */
export function testUpdate<B extends AnyBlock>(
  b: B,
  model: ModelOf<B>,
  msg: MsgOf<B>,
  options: { data?: Partial<DataOf<B>> | object; key?: string } = {}
): Recorded & { model: ModelOf<B> } {
  const draft = structuredClone(model) as Loose;
  const { ctx, outs, ops } = recordingCtx(b, draft, options.data, options.key);
  const acts = toList(specOf(b).update(draft, msg, ctx) as Tagged | readonly Tagged[] | void);
  return { model: draft as ModelOf<B>, acts, outs, ops };
}

/** Pure: runs a parent's fold of one child out-message on a copy of the parent's model. */
export function testOut<B extends AnyBlock, O extends Tagged>(
  b: B,
  child: string,
  out: O,
  model: ModelOf<B>,
  options: { data?: Partial<DataOf<B>> | object; key?: string } = {}
): Recorded & { model: ModelOf<B> } {
  const fold = specOf(b).out?.[child]?.[out.type];
  if (!fold) throw new Error(`${b.name} does not fold ${child}.${out.type}`);
  const draft = structuredClone(model) as Loose;
  const { ctx, outs, ops } = recordingCtx(b, draft, options.data, undefined);
  const acts = toList(fold(out, draft, ctx, options.key) as Tagged | readonly Tagged[] | void);
  return { model: draft as ModelOf<B>, acts, outs, ops };
}

export type Started<B extends AnyBlock> = {
  readonly app: Running<B>;
  readonly kernel: Kernel;
  /** Scripted services (absent when started with `script: false`). */
  readonly script: ReturnType<typeof scripted>;
  /** The rendered view, when `render: true`. */
  readonly container: HTMLElement;
  dispose(): void;
};

/**
 * Runs a block (a whole app, or one block on its own) against scripted
 * services: every service call waits for the test to resolve or reject it.
 * Pass the real services object; in script mode it is never called.
 */
export function start<B extends AnyBlock>(
  b: B,
  options: {
    services: ServicesOf<TypesOf<B>>;
    args?: ArgsOf<TypesOf<B>>;
    render?: boolean;
    kernel?: Kernel;
    /** False runs the real services (recorded live). Default true. */
    script?: boolean;
  }
): Started<B> {
  const live = options.script === false;
  const kernel = options.kernel ?? createKernel({ script: !live });
  const script = live ? (undefined as never) : scripted(kernel);
  const container = document.createElement("div");
  let disposeRoot = () => {};
  let disposeView = () => {};
  const app = createRoot(dispose => {
    disposeRoot = dispose;
    return run(b, { kernel, services: options.services, args: options.args });
  });
  if (options.render) {
    document.body.appendChild(container);
    disposeView = render(() => app.View(), container);
  }
  return {
    app,
    kernel,
    script,
    container,
    dispose() {
      disposeView();
      disposeRoot();
      container.remove();
    }
  };
}

/** Transition entries as "source · name", for asserting what the timeline shows. */
export function transitions(kernel: Kernel): string[] {
  return kernel.entries().flatMap(e => (e.kind === "transition" ? [`${e.source} · ${e.name}`] : []));
}

/** Service calls that actually went out (not replayed). */
export function liveCalls(kernel: Kernel): string[] {
  return kernel.entries().flatMap(e => (e.kind === "service" && e.phase === "call" && !e.replayed ? [e.path] : []));
}
