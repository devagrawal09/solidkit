// @solidkit/messages/testing: domain tests at two levels.
//
// - story(): pure tests of update. No DOM, no services, no async: send messages,
//   assert the model and the actions requested.
// - scenario(): the real program (data, actions, subscriptions) on a scripted
//   kernel. Services wait for the test to resolve or reject them.
import { createEffect, createRoot, createStore, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel, type Kernel } from "@solidkit/kernel";
import { scripted } from "@solidkit/kernel/testing";
import { createProgram, plain, renderView, toList, type ProgramSpec, type Program, type Tagged, type View } from "./index.ts";

export { settled, scripted } from "@solidkit/kernel/testing";

// ── story ─────────────────────────────────────────────────────────────────────

export type StoryContext<Model, Msg, Act> = {
  /** A plain copy of the model as it is now. */
  readonly model: Model;
  send(msg: Msg): void;
  /** The actions requested since the last call (and clears them). */
  takeActions(): Act[];
};
export type Step<Model, Msg, Act> = (story: StoryContext<Model, Msg, Act>) => void;

type Update<Model, Msg, Act, Data> = (model: Model, msg: Msg, data: Data) => Act | readonly Act[] | void;

/**
 * Runs update against a model, step by step. `data` stands in for the program's
 * derived data (a fixture: plain values where the program has memos or stores).
 */
export function story<Model extends object, Msg extends Tagged, Act extends Tagged, Data>(
  spec: { update: Update<Model, Msg, Act, Data> },
  given: { model: NoInfer<Model>; data?: NoInfer<Data> },
  ...steps: Step<NoInfer<Model>, NoInfer<Msg>, NoInfer<Act>>[]
): StoryContext<Model, Msg, Act> {
  // The store takes ownership of what it is given: copy so the caller's fixture stays put.
  const [model, setModel] = createStore<Model>(plain(structuredClone(given.model)));
  // Stories that never read data may omit the fixture.
  const data = given.data as Data;
  let requested: Act[] = [];
  const ctx: StoryContext<Model, Msg, Act> = {
    get model() {
      return snapshot(model);
    },
    send(msg) {
      let out = undefined as Act | readonly Act[] | void;
      setModel(draft => {
        out = spec.update(draft, msg, data);
      });
      requested = [...requested, ...toList(out).map(act => snapshot(act))];
    },
    takeActions() {
      const taken = requested;
      requested = [];
      return taken;
    }
  };
  for (const step of steps) step(ctx);
  return ctx;
}

/** Sends messages in order. (Typed loosely so one step can mix variants; story checks them.) */
export const send =
  (...msgs: Tagged[]): Step<any, Tagged, any> =>
  story => {
    for (const msg of msgs) story.send(msg);
  };

/** Runs a check (throw to fail, e.g. with expect) against the current model. */
export const expectModel =
  <Model>(check: (model: Model) => void): Step<Model, any, any> =>
  story =>
    check(story.model);

const show = (value: unknown) => JSON.stringify(value);

/** Asserts exactly these actions were requested since the last check. */
export const expectActions =
  (...expected: Tagged[]): Step<any, any, any> =>
  story => {
    const actual = story.takeActions();
    if (show(actual) !== show(expected)) throw new Error(`expected actions ${show(expected)}, got ${show(actual)}`);
  };

export const expectNoActions = (): Step<any, any, any> => expectActions();

// ── scenario ──────────────────────────────────────────────────────────────────

export type Script = ReturnType<typeof scripted>;

export type Scenario<Model, Msg, Data> = Program<Model, Msg, Data> & {
  readonly kernel: Kernel;
  /** The kernel's script, except resolve and reject first wait for the call to arrive. */
  readonly script: Script;
  /** The rendered view, when a view was given. */
  readonly container: HTMLElement | undefined;
  dispose(): void;
};

/**
 * Starts the real program on a scripted kernel. Pass `view` to render it (the
 * view keeps async data observed, as in the app), or `observe` to read what
 * the test cares about without a DOM.
 */
export function scenario<Model extends object, Msg extends Tagged, Act extends Tagged, Data, Services extends object, Flags = void>(
  spec: ProgramSpec<Model, Msg, Act, Data, Services, Flags>,
  options: {
    services: Services;
    flags: Flags;
    view?: View<Model, Msg, Data>;
    observe?: (app: Program<Model, Msg, Data>) => unknown;
  }
): Scenario<Model, Msg, Data> {
  const kernel = createKernel({ script: true });
  const base = scripted(kernel);
  // Actions start right after the flush that carries the message (see send), so a call
  // may arrive a tick after the test sent the message: wait for it before answering.
  const script: Script = {
    ...base,
    async resolve(path, value, args) {
      await base.expectCall(path, args);
      await base.resolve(path, value, args);
    },
    async reject(path, error, args) {
      await base.expectCall(path, args);
      await base.reject(path, error, args);
    }
  };
  let container: HTMLElement | undefined;
  let disposeView = () => {};
  const { app, dispose } = createRoot(dispose => {
    const app = createProgram(spec, { kernel, services: options.services, flags: options.flags });
    const observe = options.observe;
    if (observe) createEffect(() => observe(app), () => {});
    return { app, dispose };
  });
  const view = options.view;
  if (view) {
    container = document.createElement("div");
    document.body.append(container);
    disposeView = render(() => renderView(app, view), container);
  }
  return {
    ...app,
    kernel,
    script,
    container,
    dispose() {
      disposeView();
      container?.remove();
      dispose();
    }
  };
}
