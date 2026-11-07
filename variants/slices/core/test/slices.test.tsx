import { action, createRoot, flush, snapshot } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel, type Entry } from "@solidkit/kernel";
import { describe, expect, test } from "vitest";
import { feature, kit, replay, slice } from "../src/index.ts";
import { expectReplayable, given, scripted, settled } from "../src/testing.ts";

type Counter = { count: number; tags: string[]; last: { by: string } | null };
const initial: Counter = { count: 0, tags: [], last: null };
const counter = slice("counter", initial, {
  incremented(draft, by: number) {
    draft.count += by;
  },
  tagged(draft, tag: string, meta: { by: string }) {
    draft.tags.push(tag);
    draft.last = meta;
  },
  reset(draft) {
    draft.count = 0;
  }
});

const transitions = (entries: readonly Entry[]) =>
  entries.flatMap(e => (e.kind === "transition" ? [`${e.source}.${e.name}(${JSON.stringify(e.payload)})`] : []));

describe("slices", () => {
  test("mutations are pure functions of a draft; given() runs them on a plain object", () => {
    const [state, { incremented, tagged }] = given(counter);
    incremented(2);
    tagged("a", { by: "me" });
    expect(state).toEqual({ count: 2, tags: ["a"], last: { by: "me" } });
    expect(counter.initial).toEqual({ count: 0, tags: [], last: null }); // the definition is untouched
  });

  test("use() mounts a tracked store; every call is committed with its name and arguments", () => {
    const kernel = createKernel();
    const [state, { incremented, tagged }] = createRoot(() => kit(kernel).use(counter));
    incremented(1);
    incremented(2);
    tagged("x", { by: "test" });
    flush();
    expect(state.count).toBe(3);
    expect(transitions(kernel.entries())).toEqual([
      "counter.incremented([1])",
      "counter.incremented([2])",
      'counter.tagged(["x",{"by":"test"}])'
    ]);
    const second = kernel.entries().filter(e => e.kind === "transition")[1];
    expect(kernel.stateAt(second.seq)).toEqual({ counter: { count: 3 - 0, tags: [], last: null } });
    expect(expectReplayable(kernel)).toBe(3);
  });

  test("arguments are copied as JSON, so later changes by the caller cannot leak in", () => {
    const kernel = createKernel();
    const [state, { tagged }] = createRoot(() => kit(kernel).use(counter));
    const meta = { by: "caller" };
    tagged("t", meta);
    meta.by = "changed later";
    flush();
    expect(state.last).toEqual({ by: "caller" });
    expect(replay(kernel)).toEqual({ counter: { count: 0, tags: ["t"], last: { by: "caller" } } });
  });

  test("the timeline records logical state even while Solid holds the write", async () => {
    const kernel = createKernel();
    const k = kit(kernel);
    const [state, { incremented }] = createRoot(() => k.use(counter));
    let release!: () => void;
    const slow = action(function* () {
      incremented(1); // written in the action's first frame: held until it settles
      yield new Promise<void>(r => (release = r));
    });
    const done = slow();
    await settled();
    incremented(10); // a later frame: Solid holds this one too
    expect(snapshot(state).count).toBe(0); // what Solid shows while the action is pending
    const last = kernel.entries().filter(e => e.kind === "transition").at(-1)!;
    expect(kernel.stateAt(last.seq)).toEqual({ counter: { count: 11, tags: [], last: null } });
    release();
    await done;
    await settled();
    expect(state.count).toBe(11);
    expectReplayable(kernel);
  });

  test("rewind shows earlier state; input is ignored while rewound; resume returns to the head", async () => {
    const kernel = createKernel();
    const [state, { incremented }] = createRoot(() => kit(kernel).use(counter));
    incremented(1);
    const first = kernel.entries().at(-1)!;
    incremented(5);
    kernel.rewind(first.seq);
    await settled();
    expect(state.count).toBe(1);
    expect(incremented(100)).toBe(false);
    await settled();
    expect(state.count).toBe(1);
    expect(kernel.entries().at(-1)).toMatchObject({ kind: "note", text: "ignored counter.incremented while time traveling" });
    kernel.resume();
    await settled();
    expect(state.count).toBe(6);
    expect(replay(kernel)).toEqual({ counter: { count: 6, tags: [], last: null } });
  });

  test("named actions are recorded around Solid actions and run against scripted services", async () => {
    const kernel = createKernel({ script: true });
    const script = scripted(kernel);
    const k = kit(kernel);
    const api = k.services({ save: async (_n: number) => "saved" });
    const [state, { incremented }] = createRoot(() => k.use(counter));
    const save = k.action("save", function* (n: number) {
      const reply: string = yield api.save(n);
      incremented(n);
      return reply;
    });
    const result = save(3);
    await script.expectCall("save", [3]);
    await script.resolve("save", "ok");
    expect(await result).toBe("ok");
    expect(state.count).toBe(3);
    const labels = kernel.entries().map(e =>
      e.kind === "action" ? `action ${e.name} ${e.phase}` : e.kind === "service" ? `${e.path} ${e.phase}` : e.kind === "transition" ? `${e.source}.${e.name}` : e.text
    );
    expect(labels).toEqual(["action save start", "save call", "save result", "counter.incremented", "action save settled"]);
  });

  test("a failed action is recorded as failed and rethrows", async () => {
    const kernel = createKernel({ script: true });
    const script = scripted(kernel);
    const k = kit(kernel);
    const api = k.services({ save: async () => undefined });
    const save = k.action("save", function* () {
      yield api.save();
    });
    const failed = expect(save()).rejects.toThrow("nope");
    await script.reject("save", new Error("nope"));
    await failed;
    expect(kernel.entries().at(-1)).toMatchObject({ kind: "action", phase: "failed", name: "save", error: "nope" });
  });

  test("actions are ignored while time traveling", async () => {
    const kernel = createKernel();
    const k = kit(kernel);
    let runs = 0;
    const ping = k.action("ping", function* () {
      runs++;
    });
    const recorded = k.recorded("pong", async () => "pong");
    kernel.rewind(0);
    expect(await ping()).toBeUndefined();
    expect(await recorded()).toBeUndefined();
    expect(runs).toBe(0);
    kernel.resume();
    await ping();
    expect(await recorded()).toBe("pong");
    expect(runs).toBe(1);
  });

  test("feature() builds once per kernel and hands the result to the view through context", () => {
    const Counter = feature((k, start: number) => {
      const [state, mutations] = k.use(counter, { ...initial, count: start });
      return { state, ...mutations };
    });
    const kernel = createKernel();
    const el = document.createElement("div");
    function View() {
      const c = Counter.use();
      return <button onClick={() => c.incremented(1)}>{c.state.count}</button>;
    }
    const dispose = render(() => <Counter.Context value={Counter.create(kernel, 41)}><View /></Counter.Context>, el);
    flush();
    expect(el.textContent).toBe("41");
    (el.querySelector("button") as HTMLButtonElement).click();
    flush();
    expect(el.textContent).toBe("42");
    expect(replay(kernel)).toEqual({ counter: { count: 42, tags: [], last: null } });
    dispose();
  });
});
