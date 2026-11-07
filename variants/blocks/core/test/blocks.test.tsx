import { action, createMemo, createOptimisticStore, For, Loading, onCleanup, refresh } from "solid-js";
import { describe, expect, test } from "vitest";
import { block, driven, field, keyed, missingServices, variants, type Handler } from "../src/index.ts";
import { liveCalls, settled, start, testOut, testUpdate, transitions } from "../src/testing.ts";

// ── Fixtures: a counter child, a parent with two counters, a keyed list ─────

type CounterModel = { n: number };
type CounterMsg = { type: "Incremented" } | { type: "RequestedReset" };
type CounterOut = { type: "Overflowed"; at: number };
const CounterMsg = variants<CounterMsg>();

const Counter = block<{ model: CounterModel; msg: CounterMsg; out: CounterOut; args: { start: number } }>()({
  name: "Counter",
  requires: {},
  init: args => ({ n: args.start }),
  update(model, msg, ctx) {
    switch (msg.type) {
      case "Incremented":
        model.n++;
        if (model.n > 2) ctx.emit({ type: "Overflowed", at: model.n });
        return;
      case "RequestedReset":
        model.n = 0;
        return;
    }
  },
  operations: { reset: () => CounterMsg.RequestedReset() },
  view: props => <button onClick={() => props.send(CounterMsg.Incremented())}>{props.model.n}</button>
});

type PairModel = { overflows: number; left: CounterModel; right: CounterModel };
type PairMsg = { type: "ClickedResetAll" };

const Pair = block<{ model: PairModel; msg: PairMsg }>()({
  name: "pair",
  requires: {},
  children: {
    left: field(Counter, { init: () => ({ start: 0 }) }),
    right: field(Counter, { init: () => ({ start: 1 }) })
  },
  init: () => ({ overflows: 0 }),
  update(_model, _msg, ctx) {
    ctx.blocks.left.reset();
    ctx.blocks.right.reset();
  },
  out: {
    left: {
      Overflowed: (_out, model, ctx) => {
        model.overflows++;
        ctx.blocks.right.reset();
      }
    },
    right: {
      Overflowed: (_out, model) => {
        model.overflows++;
      }
    }
  },
  view: props => (
    <div>
      <props.blocks.left />
      <props.blocks.right />
      <p>{props.model.overflows}</p>
    </div>
  )
});

type ItemModel = { label: string; done: boolean };
type ItemMsg = { type: "Toggled" } | { type: "Renamed"; label: string };
const ItemMsg = variants<ItemMsg>();
const disposedItems: string[] = [];

const Item = block<{ model: ItemModel; msg: ItemMsg; out: { type: "Finished" }; args: { label: string } }>()({
  name: "Item",
  requires: {},
  init: args => ({ label: args.label, done: false }),
  data: (model, _services, ctx) => {
    onCleanup(() => disposedItems.push(ctx.key ?? "?"));
    return { shout: createMemo(() => model.label.toUpperCase()) };
  },
  update(model, msg, ctx) {
    switch (msg.type) {
      case "Toggled":
        model.done = !model.done;
        if (model.done) ctx.emit({ type: "Finished" });
        return;
      case "Renamed":
        model.label = msg.label;
        return;
    }
  },
  operations: { rename: (label: string) => ItemMsg.Renamed({ label }) },
  view: props => <li onClick={() => props.send(ItemMsg.Toggled())}>{props.data.shout()}</li>
});

type ListModel = { items: Record<string, ItemModel>; finished: number; nextId: number };
type ListMsg = { type: "Added"; label: string } | { type: "Removed"; id: string } | { type: "RenamedAll" };

const List = block<{ model: ListModel; msg: ListMsg }>()({
  name: "list",
  requires: {},
  children: { items: keyed(Item, { initial: () => ({ a: { label: "first" } }) }) },
  init: () => ({ finished: 0, nextId: 1 }),
  update(model, msg, ctx) {
    switch (msg.type) {
      case "Added":
        ctx.blocks.items.insert(`i${model.nextId++}`, { label: msg.label });
        return;
      case "Removed":
        ctx.blocks.items.remove(msg.id);
        return;
      case "RenamedAll":
        for (const id of Object.keys(model.items)) ctx.blocks.items.at(id).rename("renamed " + id);
        return;
    }
  },
  out: {
    items: {
      Finished: (_out, model) => {
        model.finished++;
      }
    }
  },
  view: props => (
    <ul>
      <For each={Object.keys(props.model.items)}>{id => <props.blocks.items key={id} />}</For>
    </ul>
  )
});

// ── Pure tests ──────────────────────────────────────────────────────────────

describe("pure updates", () => {
  test("testUpdate records out-messages and leaves the input untouched", () => {
    const model = { n: 2 };
    const r = testUpdate(Counter, model, CounterMsg.Incremented());
    expect(r.model).toEqual({ n: 3 });
    expect(r.outs).toEqual([{ type: "Overflowed", at: 3 }]);
    expect(model).toEqual({ n: 2 });
  });

  test("operations a parent calls are recorded, not run", () => {
    const r = testUpdate(Pair, { overflows: 0, left: { n: 1 }, right: { n: 2 } }, { type: "ClickedResetAll" });
    expect(r.ops).toEqual([
      { block: "left", op: "reset", args: [] },
      { block: "right", op: "reset", args: [] }
    ]);
    expect(r.model.left).toEqual({ n: 1 }); // children change only through their own update
  });

  test("testOut runs a parent's fold of a child's out-message", () => {
    const r = testOut(Pair, "left", { type: "Overflowed", at: 3 }, { overflows: 0, left: { n: 3 }, right: { n: 2 } });
    expect(r.model.overflows).toBe(1);
    expect(r.ops).toEqual([{ block: "right", op: "reset", args: [] }]);
  });

  test("keyed insert and remove write the parent's draft", () => {
    const r = testUpdate(List, { items: {}, finished: 0, nextId: 4 }, { type: "Added", label: "x" });
    expect(r.model.items).toEqual({ i4: { label: "x", done: false } });
    expect(r.model.nextId).toBe(5);
  });
});

// ── Composition at run time ─────────────────────────────────────────────────

describe("composition", () => {
  test("child messages route to the child's slice; the timeline shows block paths", async () => {
    const t = start(Pair, { services: {}, render: true });
    await settled();
    const [left] = t.container.querySelectorAll("button");
    left.click();
    await settled();
    expect(t.app.model.left.n).toBe(1);
    expect(t.app.model.right.n).toBe(1);
    expect(t.container.textContent).toBe("110");
    expect(transitions(t.kernel)).toEqual(["pair · init", "pair/left · Incremented"]);
    t.dispose();
  });

  test("out-messages are folded by the parent, which can call a sibling's operation", async () => {
    const t = start(Pair, { services: {} });
    const left = t.app.at<typeof Counter>("left");
    left.send(CounterMsg.Incremented());
    left.send(CounterMsg.Incremented());
    left.send(CounterMsg.Incremented()); // 3: overflow
    await settled();
    expect(t.app.model).toEqual({ overflows: 1, left: { n: 3 }, right: { n: 0 } });
    expect(transitions(t.kernel).slice(-3)).toEqual(["pair/left · Incremented", "pair · left.Overflowed", "pair/right · RequestedReset"]);
    t.dispose();
  });

  test("a parent's own message calls both children's operations", async () => {
    const t = start(Pair, { services: {} });
    t.app.send({ type: "ClickedResetAll" });
    await settled();
    expect(t.app.model.right.n).toBe(0);
    expect(transitions(t.kernel).slice(1)).toEqual(["pair · ClickedResetAll", "pair/left · RequestedReset", "pair/right · RequestedReset"]);
    t.dispose();
  });

  test("keyed instances: created from the model, addressed by key, disposed on removal", async () => {
    disposedItems.length = 0;
    const t = start(List, { services: {}, render: true });
    await settled();
    expect(t.container.textContent).toBe("FIRST");
    t.app.send({ type: "Added", label: "second" });
    await settled();
    expect(t.container.textContent).toBe("FIRSTSECOND");
    t.app.send({ type: "RenamedAll" });
    await settled();
    expect(t.container.textContent).toBe("RENAMED ARENAMED I1");
    expect(transitions(t.kernel).slice(-2)).toEqual(["list/items[a] · Renamed", "list/items[i1] · Renamed"]);

    (t.container.querySelectorAll("li")[1] as HTMLElement).click();
    await settled();
    expect(t.app.model.finished).toBe(1);
    expect(transitions(t.kernel).slice(-2)).toEqual(["list/items[i1] · Toggled", "list · items[i1].Finished"]);

    const gone = t.app.at<typeof Item>("items[i1]");
    t.app.send({ type: "Removed", id: "i1" });
    await settled();
    expect(disposedItems).toEqual(["i1"]);
    expect(t.container.textContent).toBe("RENAMED A");
    gone.send(ItemMsg.Toggled()); // the instance is gone: dropped and noted
    await settled();
    expect(t.kernel.entries().at(-1)).toMatchObject({ kind: "note" });
    t.dispose();
    expect(disposedItems).toEqual(["i1", "a"]); // disposed with their owner
  });

  test("time travel restores nested and keyed state; input is ignored while rewound", async () => {
    disposedItems.length = 0;
    const t = start(List, { services: {}, render: true });
    await settled();
    t.app.send({ type: "Added", label: "second" });
    await settled();
    const added = t.kernel.entries().at(-1)!.seq;
    t.app.send({ type: "Removed", id: "a" });
    await settled();
    expect(t.container.textContent).toBe("SECOND");

    t.kernel.rewind(added);
    await settled();
    expect(t.container.textContent).toBe("FIRSTSECOND");
    expect(t.app.at("items[a]").state()).toEqual({ label: "first", done: false });
    const before = t.kernel.entries().length;
    t.app.send({ type: "Added", label: "ignored" });
    await settled();
    expect(t.kernel.entries().slice(before)).toMatchObject([{ kind: "note", text: "ignored Added for list while time traveling" }]);

    t.kernel.resume();
    await settled();
    expect(t.container.textContent).toBe("SECOND");
    t.dispose();
  });

  test("any block runs on its own (per-block tests and time travel)", async () => {
    const t = start(Counter, { services: {}, args: { start: 5 } });
    t.app.send(CounterMsg.Incremented());
    await settled();
    expect(t.app.state()).toEqual({ n: 6 });
    expect(t.app.state(t.kernel.entries()[0].seq)).toEqual({ n: 5 });
    t.dispose();
  });
});

// ── Services, actions, time travel ──────────────────────────────────────────

type Todo = { id: string; title: string };
type Api = { list(): Promise<Todo[]>; add(todo: Todo): Promise<void> };
const api: Api = { list: async () => [], add: async () => {} };
type TodosMsg = { type: "Submitted"; id: string; title: string } | { type: "AddFailed"; id: string };
type TodosAct = { type: "add"; todo: Todo };

const Todos = block<{ model: { failed: string[] }; msg: TodosMsg; act: TodosAct; services: { api: Api } }>()({
  name: "todos",
  requires: { api: true },
  init: () => ({ failed: [] }),
  data: (_model, services, ctx) => {
    const [todos, setTodos] = createOptimisticStore<Todo[]>(() => services.api.list(), []);
    ctx.refreshable(todos);
    return { todos, setTodos };
  },
  update(model, msg) {
    switch (msg.type) {
      case "Submitted":
        return { type: "add", todo: { id: msg.id, title: msg.title } };
      case "AddFailed":
        model.failed.push(msg.id);
        return;
    }
  },
  actions: ({ todos, setTodos }, services) => ({
    *add({ todo }) {
      setTodos(t => {
        t.push(todo);
      });
      try {
        yield services.api.add(todo);
      } finally {
        refresh(todos);
      }
    }
  }),
  onActionError: act => ({ type: "AddFailed", id: act.todo.id }),
  view: props => (
    <Loading>
      <p>
        {props.data.todos.map(t => t.title).join(",")}|{props.model.failed.join(",")}
      </p>
    </Loading>
  )
});

describe("services and actions", () => {
  test("missing services are reported with the block path at assembly", () => {
    const Shell = block<{ model: { todos: { failed: string[] } }; msg: { type: "Noop" }; services: { api: Api } }>()({
      name: "shell",
      requires: { api: true },
      children: { todos: field(Todos) },
      init: () => ({}),
      update() {}
    });
    expect(missingServices(Shell, {})).toEqual(["api (needed by shell)", "api (needed by shell/todos)"]);
    expect(() => start(Shell, { services: {} as { api: Api } })).toThrow("Missing services: api (needed by shell)");
  });

  test("a failed action reverts its optimistic write and lands its failure in the same transition", async () => {
    const t = start(Todos, { services: { api }, render: true });
    await t.script.resolve("api.list", [{ id: "1", title: "one" }]);
    expect(t.container.textContent).toBe("one|");

    t.app.send({ type: "Submitted", id: "2", title: "two" });
    await settled();
    expect(t.container.textContent).toBe("one,two|");
    await t.script.reject("api.add", new Error("down"));
    await t.script.expectCall("api.list"); // the handler's finally refreshes
    expect(t.container.textContent).toBe("one,two|"); // held until the refetch lands
    await t.script.resolve("api.list", [{ id: "1", title: "one" }]);
    expect(t.container.textContent).toBe("one|2"); // revert and failure land together

    expect(transitions(t.kernel)).toEqual(["todos · init", "todos · Submitted", "todos · AddFailed"]);
    const actions = t.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(actions).toEqual(["todos:add start", "todos:add failed"]);
    // committed when the transition landed, so the snapshot has the failure
    const failedAt = t.kernel.entries().find(e => e.kind === "transition" && e.name === "AddFailed")!.seq;
    expect(t.app.state(failedAt)).toEqual({ failed: ["2"] });
    t.dispose();
  });

  test("rewinding replays services instead of calling them", async () => {
    const t = start(Todos, { services: { api }, render: true });
    await t.script.resolve("api.list", [{ id: "1", title: "one" }]);
    t.app.send({ type: "Submitted", id: "2", title: "two" });
    await t.script.resolve("api.add");
    await t.script.resolve("api.list", [
      { id: "1", title: "one" },
      { id: "2", title: "two" }
    ]);
    expect(t.container.textContent).toBe("one,two|");
    const calls = liveCalls(t.kernel).length;

    t.kernel.rewind(t.kernel.entries().find(e => e.kind === "transition" && e.name === "Submitted")!.seq - 1);
    await settled();
    expect(t.container.textContent).toBe("one|");
    t.script.expectNoCalls();
    expect(liveCalls(t.kernel).length).toBe(calls);

    t.kernel.resume(); // live again: the refresh asks the (scripted) server
    await t.script.expectCall("api.list");
    await t.script.resolve("api.list", [
      { id: "1", title: "one" },
      { id: "2", title: "two" }
    ]);
    expect(t.container.textContent).toBe("one,two|");
    t.dispose();
  });
});

describe("drivers and streams", () => {
  test("closing a recorded AsyncIterable closes its source at once (superseded flights stop)", async () => {
    const log: string[] = [];
    type Feed = { open(q: string): AsyncIterable<string> };
    const feed: Feed = {
      open: q => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return: async () => {
            log.push("closed " + q);
            return { done: true as const, value: undefined };
          }
        })
      })
    };
    const Stream = block<{ model: { q: string }; msg: { type: "Typed"; q: string }; services: { feed: Feed } }>()({
      name: "stream",
      requires: { feed: true },
      init: () => ({ q: "a" }),
      update(model, msg) {
        model.q = msg.q;
      },
      data: (model, services) => ({ latest: createMemo(() => services.feed.open(model.q)) }),
      view: props => (
        <Loading>
          <p>{props.data.latest()}</p>
        </Loading>
      )
    });
    const t = start(Stream, { services: { feed }, script: false, render: true });
    await settled();
    t.app.send({ type: "Typed", q: "b" });
    await settled();
    expect(log).toEqual(["closed a"]);
    t.dispose();
  });

  test("driven handlers: another driver runs them; steps, errors and interrupt still go through the block", async () => {
    const log: string[] = [];
    let release!: (ok: boolean) => void;
    const drive = (gen: Handler<{ type: "go" }>) =>
      Object.assign(action(gen), {
        interrupt: () => {
          log.push("interrupted");
          release(false);
        }
      });
    type Msg = { type: "ClickedGo" } | { type: "ClickedStop" } | { type: "Stopped" };
    type Act = { type: "go" } | { type: "stop" };
    const Job = block<{ model: { stopped: number }; msg: Msg; act: Act }>()({
      name: "job",
      requires: {},
      init: () => ({ stopped: 0 }),
      update(model, msg) {
        if (msg.type === "ClickedGo") return { type: "go" };
        if (msg.type === "ClickedStop") return { type: "stop" };
        model.stopped++;
      },
      actions: (_data, _services, ctx) => ({
        go: driven(drive, function* () {
          const ok: boolean = yield new Promise<boolean>(r => (release = r)).then(ok => {
            if (!ok) throw new Error("interrupted");
            return ok;
          });
          return ok;
        }),
        *stop() {
          ctx.interrupt("go");
        }
      }),
      onActionError: () => ({ type: "Stopped" })
    });
    const t = start(Job, { services: {} });
    t.app.send({ type: "ClickedGo" });
    await settled();
    t.app.send({ type: "ClickedStop" });
    await settled();
    expect(log).toEqual(["interrupted"]);
    expect(t.app.model.stopped).toBe(1);
    const actions = t.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(actions).toEqual(["job:go start", "job:stop start", "job:stop settled", "job:go failed"]);
    t.dispose();
  });
});

describe("subscriptions", () => {
  test("start and stop by key as the model changes", async () => {
    let tick: (() => void) | undefined;
    let starts = 0;
    let stops = 0;
    const Ticker = block<{ model: { on: boolean; ticks: number }; msg: { type: "Toggled" } | { type: "Ticked" } }>()({
      name: "ticker",
      requires: {},
      init: () => ({ on: false, ticks: 0 }),
      update(model, msg) {
        if (msg.type === "Toggled") model.on = !model.on;
        else model.ticks++;
      },
      subscriptions: model => [
        model.on && {
          key: "tick",
          start: send => {
            starts++;
            tick = () => send({ type: "Ticked" });
            return () => {
              stops++;
              tick = undefined;
            };
          }
        }
      ]
    });
    const t = start(Ticker, { services: {} });
    await settled();
    expect(starts).toBe(0);
    t.app.send({ type: "Toggled" });
    await settled();
    tick?.();
    tick?.();
    await settled();
    expect(t.app.model.ticks).toBe(2);
    t.app.send({ type: "Toggled" });
    await settled();
    expect([starts, stops, tick]).toEqual([1, 1, undefined]);
    t.dispose();
  });
});

// ── Type-level checks (tsc runs over this file) ─────────────────────────────

describe("types", () => {
  test("bindings check slots and services; out policies are required and exhaustive", () => {
    const NeedsApi = block<{ model: { x: number }; msg: { type: "X" }; services: { api: Api } }>()({
      name: "needsApi",
      requires: { api: true },
      init: () => ({ x: 0 }),
      update() {}
    });
    block<{ model: { child: { x: number } }; msg: { type: "Y" } }>()({
      name: "noServices",
      requires: {},
      // @ts-expect-error the parent does not provide the child's services
      children: { child: field(NeedsApi) },
      init: () => ({}),
      update() {}
    });
    block<{ model: { child: { y: string } }; msg: { type: "Y" }; services: { api: Api } }>()({
      name: "wrongSlot",
      requires: { api: true },
      // @ts-expect-error the parent's field does not hold the child's model
      children: { child: field(NeedsApi) },
      init: () => ({}),
      update() {}
    });
    // @ts-expect-error a child with out-messages needs an out policy
    block<{ model: { left: CounterModel }; msg: { type: "Y" } }>()({
      name: "noPolicy",
      requires: {},
      children: { left: field(Counter, { init: () => ({ start: 0 }) }) },
      init: () => ({}),
      update() {}
    });
    block<{ model: { x: number }; msg: { type: "Y" }; services: { api: Api } }>()({
      name: "unlisted",
      // @ts-expect-error every required service is listed for the run-time check
      requires: {},
      init: () => ({ x: 0 }),
      update() {}
    });
    expect(true).toBe(true);
  });
});
