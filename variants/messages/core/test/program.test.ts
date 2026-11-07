import { createOptimisticStore, flush, refresh } from "solid-js";
import { describe, expect, test } from "vitest";
import { createKernel } from "@solidkit/kernel";
import { createProgram, every, variants, type Handlers, type ProgramSpec } from "../src/index.ts";
import { expectActions, expectModel, scenario, send, settled, story } from "../src/testing.ts";

// A tiny program: a list of items on a "server", with a draft and per-item failures.
type Item = { id: string; done: boolean; pending?: boolean };
type Model = { draft: string; failures: Record<string, string>; ticking: boolean; ticks: number };
type Msg =
  | { type: "Typed"; text: string }
  | { type: "Submitted" }
  | { type: "Toggled"; id: string; done: boolean }
  | { type: "Saved"; id: string }
  | { type: "Failed"; id: string; error: string }
  | { type: "StartedTicking" }
  | { type: "Ticked" };
type Act = { type: "add"; id: string } | { type: "toggle"; id: string; done: boolean };
const Msg = variants<Msg>();
const Act = variants<Act>();

const api = {
  list: async (): Promise<Item[]> => [],
  add: async (_id: string): Promise<void> => {},
  toggle: async (_id: string, _done: boolean): Promise<void> => {}
};
type Services = { api: typeof api };

function data(_model: Model, { api }: Services) {
  const [items, setItems] = createOptimisticStore<Item[]>(() => api.list(), []);
  return { items, setItems };
}
type Data = ReturnType<typeof data>;

const spec: ProgramSpec<Model, Msg, Act, Data, Services> = {
  name: "items",
  init: () => ({ draft: "", failures: {}, ticking: false, ticks: 0 }),
  update(model, msg) {
    switch (msg.type) {
      case "Typed":
        model.draft = msg.text;
        return;
      case "Submitted": {
        const id = model.draft.trim();
        if (!id) return;
        model.draft = "";
        return Act.add({ id });
      }
      case "Toggled":
        return Act.toggle({ id: msg.id, done: msg.done });
      case "Saved":
        delete model.failures[msg.id];
        return;
      case "Failed":
        model.failures[msg.id] = msg.error;
        return;
      case "StartedTicking":
        model.ticking = true;
        return;
      case "Ticked":
        model.ticks++;
        return;
    }
  },
  data,
  sources: data => [data.items],
  actions: ({ items, setItems }, { api }): Handlers<Act, Msg> => ({
    *add({ id }) {
      setItems(list => {
        list.push({ id, done: false, pending: true });
      });
      yield api.add(id);
      refresh(items);
      return Msg.Saved({ id });
    },
    *toggle({ id, done }) {
      setItems(list => {
        const item = list.find(i => i.id === id);
        if (item) Object.assign(item, { done, pending: true });
      });
      yield api.toggle(id, done);
      refresh(items);
      return Msg.Saved({ id });
    }
  }),
  onActionError: (act, error) => Msg.Failed({ id: act.id, error: String(error) }),
  subscriptions: model => [model.ticking && every(10, () => Msg.Ticked())]
};

const view = (s: { data: { items: Item[] } }) => s.data.items.map(i => ({ id: i.id, done: i.done, pending: !!i.pending }));
const start = () => scenario(spec, { services: { api }, flags: undefined, observe: app => JSON.stringify(app.data.items) });
const timeline = (s: ReturnType<typeof start>) =>
  s.kernel.entries().map(e =>
    e.kind === "transition" ? `msg ${e.name}` : e.kind === "action" ? `act ${e.name} ${e.phase}` : e.kind === "service" ? `svc ${e.path} ${e.phase}` : `note ${e.text}`
  );

describe("story (pure update tests)", () => {
  test("submitting a draft clears it and requests an add", () => {
    story(
      spec,
      { model: spec.init() },
      send(Msg.Typed({ text: " milk " }), Msg.Submitted()),
      expectModel<Model>(m => expect(m.draft).toBe("")),
      expectActions(Act.add({ id: "milk" })),
      send(Msg.Submitted()),
      expectActions()
    );
  });

  test("a failure is recorded per item and a save clears it", () => {
    const s = story(spec, { model: spec.init() }, send(Msg.Failed({ id: "a", error: "boom" })));
    expect(s.model.failures).toEqual({ a: "boom" });
    s.send(Msg.Saved({ id: "a" }));
    expect(s.model.failures).toEqual({});
  });

  test("the given model is not mutated", () => {
    const given = spec.init();
    story(spec, { model: given }, send(Msg.Typed({ text: "x" })));
    expect(given.draft).toBe("");
  });
});

describe("program", () => {
  test("every message is a committed transition with a snapshot", async () => {
    const s = start();
    await s.script.resolve("api.list", []);
    s.send(Msg.Typed({ text: "a" }));
    const entry = s.kernel.entries().at(-1)!;
    expect(entry).toMatchObject({ kind: "transition", source: "items", name: "Typed", payload: { type: "Typed", text: "a" } });
    expect(s.kernel.stateAt(entry.seq)).toEqual({ items: { draft: "a", failures: {}, ticking: false, ticks: 0 } });
    s.dispose();
  });

  test("a model write is not held by the action it requests", async () => {
    const s = start();
    await s.script.resolve("api.list", []);
    s.send(Msg.Typed({ text: "milk" }));
    s.send(Msg.Submitted());
    await s.script.expectCall("api.add", ["milk"]);
    flush();
    expect(s.model.draft).toBe(""); // visible now, while api.add is still pending
    expect(view(s)).toEqual([{ id: "milk", done: false, pending: true }]);
    s.dispose();
  });

  test("success: the returned message lands with the refreshed data", async () => {
    const s = start();
    await s.script.resolve("api.list", []);
    s.send(Msg.Toggled({ id: "x", done: true }));
    await s.script.resolve("api.toggle");
    await s.script.resolve("api.list", [{ id: "x", done: true }]);
    expect(view(s)).toEqual([{ id: "x", done: true, pending: false }]);
    const t = timeline(s);
    expect(t.slice(0, 7)).toEqual([
      "svc api.list call",
      "svc api.list result",
      "msg Toggled",
      "act toggle start",
      "svc api.toggle call",
      "svc api.toggle result",
      "svc api.list call" // the refresh
    ]);
    // the success message is committed once its transition lands (with or after the refresh)
    expect(t.slice(7).sort()).toEqual(["act toggle settled", "msg Saved", "svc api.list result"]);
    const saved = s.kernel.entries().find(e => e.kind === "transition" && e.name === "Saved")!;
    expect(s.kernel.stateAt(saved.seq)).toMatchObject({ items: { failures: {} } });
    s.dispose();
  });

  test("failure: onActionError's message lands in the same frame as the optimistic revert", async () => {
    const frames: string[] = [];
    const s = scenario(spec, {
      services: { api },
      flags: undefined,
      observe: app => JSON.stringify({ failures: app.model.failures, items: app.data.items })
    });
    const { createEffect, createRoot } = await import("solid-js");
    createRoot(() =>
      createEffect(
        () => JSON.stringify({ failures: s.model.failures, items: s.data.items.map(i => [i.done, !!i.pending]) }),
        frame => void frames.push(frame)
      )
    );
    await s.script.resolve("api.list", [{ id: "x", done: false }]);
    s.send(Msg.Toggled({ id: "x", done: true }));
    await s.script.expectCall("api.toggle");
    expect(view(s)).toEqual([{ id: "x", done: true, pending: true }]);
    await s.script.reject("api.toggle", new Error("Failed to Save"));
    expect(s.model.failures).toEqual({ x: "Error: Failed to Save" });
    expect(view(s)).toEqual([{ id: "x", done: false, pending: false }]);
    // no frame ever showed the failure next to the optimistic value, or neither
    const distinct = frames.filter((f, i) => f !== frames[i - 1]);
    expect(distinct.slice(-3)).toEqual([
      JSON.stringify({ failures: {}, items: [[false, false]] }),
      JSON.stringify({ failures: {}, items: [[true, true]] }),
      JSON.stringify({ failures: { x: "Error: Failed to Save" }, items: [[false, false]] })
    ]);
    expect(timeline(s).at(-3)).toBe("svc api.toggle error");
    expect(timeline(s).slice(-2).sort()).toEqual(["act toggle failed", "msg Failed"]);
    // the snapshot for the failure has the failure in it
    const failed = s.kernel.entries().at(-1)!;
    expect(s.kernel.stateAt(failed.seq)).toMatchObject({ items: { failures: { x: "Error: Failed to Save" } } });
    s.dispose();
  });

  test("rewind restores the model, replays data and drops input; resume brings back the head", async () => {
    const s = start();
    await s.script.resolve("api.list", [{ id: "x", done: false }]);
    s.send(Msg.Typed({ text: "draft" }));
    const typed = s.kernel.entries().at(-1)!.seq;
    s.send(Msg.Toggled({ id: "x", done: true }));
    await s.script.resolve("api.toggle");
    await s.script.resolve("api.list", [{ id: "x", done: true }]);
    expect(view(s)).toEqual([{ id: "x", done: true, pending: false }]);

    s.kernel.rewind(typed);
    await settled();
    s.script.expectNoCalls(); // replayed, not called
    expect(s.model.draft).toBe("draft");
    expect(view(s)).toEqual([{ id: "x", done: false, pending: false }]);
    s.send(Msg.Typed({ text: "ignored" }));
    expect(s.model.draft).toBe("draft");
    expect(s.kernel.entries().at(-1)).toMatchObject({ kind: "note", text: "ignored Typed while time traveling" });

    s.kernel.resume();
    await s.script.resolve("api.list", [{ id: "x", done: true }]); // live again
    expect(view(s)).toEqual([{ id: "x", done: true, pending: false }]);
    s.dispose();
  });

  test("an action that settles while rewound has its message held until resume", async () => {
    const s = start();
    await s.script.resolve("api.list", []);
    s.send(Msg.Typed({ text: "a" }));
    s.send(Msg.Submitted());
    await s.script.expectCall("api.add");
    s.kernel.rewind(s.kernel.entries()[0].seq);
    await settled();
    await s.script.reject("api.add", new Error("offline"));
    await settled();
    expect(s.model.failures).toEqual({});
    expect(s.kernel.entries().some(e => e.kind === "note" && e.text === "held Failed until resume")).toBe(true);
    s.kernel.resume();
    await settled();
    expect(s.model.failures).toEqual({ a: "Error: offline" });
    s.dispose();
  });

  test("subscriptions follow the model by key", async () => {
    const s = start();
    await s.script.resolve("api.list", []);
    s.send(Msg.StartedTicking());
    await new Promise(r => setTimeout(r, 35));
    await settled();
    const ticks = s.model.ticks;
    expect(ticks).toBeGreaterThan(1);
    s.dispose(); // stops the interval
    await new Promise(r => setTimeout(r, 30));
    expect(s.model.ticks).toBe(ticks);
  });

  test("createProgram wires a live kernel: services recorded, actions named", async () => {
    const kernel = createKernel();
    const calls: string[] = [];
    const live = { ...api, list: async () => (calls.push("list"), [] as Item[]) };
    const { createRoot } = await import("solid-js");
    const app = createRoot(() => {
      const app = createProgram(spec, { kernel, services: { api: live }, flags: undefined });
      return app;
    });
    await settled();
    app.send(Msg.Typed({ text: "z" }));
    expect(kernel.entries().at(-1)).toMatchObject({ kind: "transition", name: "Typed" });
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});
