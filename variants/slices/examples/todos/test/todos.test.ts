// Scenario tests: the real feature (data, actions, slice) against scripted
// services. Solid runs for real: optimistic writes, reverts, refresh.
import { createEffect, createRoot } from "solid-js";
import { createKernel } from "@solidkit/kernel";
import { describe, expect, test } from "vitest";
import { expectReplayable, scripted, settled } from "@solidkit/slices/testing";
import { api } from "../src/api";
import { Todos } from "../src/todos";

const one = { id: "1", title: "Write the RFC", completed: false };
const two = { id: "2", title: "Ship it", completed: true };

async function start(server = [one]) {
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const app = createRoot(() => {
    const app = Todos.create(kernel, api, "#/");
    // Stand-in for the view: keep the list observed.
    createEffect(
      () => app.todos.map(t => [t.id, t.completed, t.pending, t.error?.type]),
      () => {}
    );
    return app;
  });
  await script.expectCall("api.getTodos");
  await script.resolve("api.getTodos", server);
  return { kernel, script, app };
}

const rows = (app: { todos: readonly { id: string; completed: boolean; pending?: boolean; error?: { type: string } }[] }) =>
  app.todos.map(t => `${t.id}:${t.completed ? "done" : "open"}${t.pending ? ":pending" : ""}${t.error ? ":" + t.error.type : ""}`);

describe("todos", () => {
  test("loads, then a toggle shows at once and settles to what the server says", async () => {
    const { app, script, kernel } = await start();
    expect(rows(app)).toEqual(["1:open"]);
    void app.toggleTodo("1", true);
    await settled();
    expect(rows(app)).toEqual(["1:done:pending"]);
    await script.resolve("api.toggleTodo", undefined, ["1", true]);
    await script.resolve("api.getTodos", [{ ...one, completed: true }]);
    expect(rows(app)).toEqual(["1:done"]);
    script.expectNoCalls();
    expectReplayable(kernel);
  });

  test("a failed toggle reverts and leaves a retry; the retry goes through", async () => {
    const { app, script } = await start();
    void app.toggleTodo("1", true);
    await script.reject("api.toggleTodo", "Failed to Save");
    await script.resolve("api.getTodos", [one]);
    expect(rows(app)).toEqual(["1:open:toggleTodo"]);
    void app.retryTodo(app.todos[0]);
    await settled();
    expect(rows(app)).toEqual(["1:done:pending:toggleTodo"]);
    await script.resolve("api.toggleTodo", undefined, ["1", true]);
    await script.resolve("api.getTodos", [{ ...one, completed: true }]);
    expect(rows(app)).toEqual(["1:done"]);
  });

  test("a failed add stays visible with its error, and retrying it adds it", async () => {
    const { app, script } = await start();
    const draft = { id: "2", title: "Draft", completed: false };
    void app.addTodo(draft);
    await settled();
    expect(rows(app)).toEqual(["1:open", "2:open:pending"]);
    await script.reject("api.addTodo", "Failed to Save");
    await script.resolve("api.getTodos", [one]);
    expect(rows(app)).toEqual(["1:open", "2:open:addTodo"]);
    void app.retryTodo(app.todos[1]);
    await settled();
    expect(rows(app)).toEqual(["1:open", "2:open:pending:addTodo"]);
    await script.resolve("api.addTodo", draft);
    await script.resolve("api.getTodos", [one, draft]);
    expect(rows(app)).toEqual(["1:open", "2:open"]);
  });

  test("bulk failures fan out to per-item retries", async () => {
    const { app, script, kernel } = await start([one, two, { id: "3", title: "Test it", completed: false }]);
    void app.toggleAll(true);
    await settled();
    expect(rows(app)).toEqual(["1:done:pending", "2:done", "3:done:pending"]);
    await script.reject("api.toggleAll", "Failed to Save", [["1", "3"], true]);
    await script.resolve("api.getTodos", [one, two, { id: "3", title: "Test it", completed: false }]);
    expect(rows(app)).toEqual(["1:open:toggleTodo", "2:done", "3:open:toggleTodo"]);

    void app.clearCompleted();
    await settled();
    expect(rows(app)).toEqual(["1:open:toggleTodo", "3:open:toggleTodo"]);
    await script.reject("api.clearCompleted", "Failed to Save", [["2"]]);
    await script.resolve("api.getTodos", [one, two, { id: "3", title: "Test it", completed: false }]);
    expect(rows(app)).toEqual(["1:open:toggleTodo", "2:done:removeTodo", "3:open:toggleTodo"]);
    expectReplayable(kernel);
  });

  test("removing an item hides it at once; a failed remove brings it back with a retry", async () => {
    const { app, script } = await start([one, two]);
    void app.removeTodo("2");
    await settled();
    expect(rows(app)).toEqual(["1:open"]);
    await script.reject("api.removeTodo", "Failed to Save");
    await script.resolve("api.getTodos", [one, two]);
    expect(rows(app)).toEqual(["1:open", "2:done:removeTodo"]);
  });

  test("time travel: rewinding shows the list as it was, with no live calls", async () => {
    const { app, script, kernel } = await start();
    void app.toggleTodo("1", true);
    await script.reject("api.toggleTodo", "Failed to Save");
    await script.resolve("api.getTodos", [one]);
    app.filterChanged("active");
    await settled();
    expect(rows(app)).toEqual(["1:open:toggleTodo"]);
    expect(app.state.filter).toBe("active");

    // Back to just after the first load: no error, filter "all".
    const loaded = kernel.entries().find(e => e.kind === "service" && e.path === "api.getTodos" && e.phase === "result")!;
    kernel.rewind(loaded.seq);
    await settled();
    expect(app.state.filter).toBe("all");
    expect(app.state.errors).toEqual({});
    expect(rows(app)).toEqual(["1:open"]);
    script.expectNoCalls(); // the refetch was answered from the recording
    expect(kernel.entries().some(e => e.kind === "service" && e.replayed)).toBe(true);

    // Input is ignored while rewound.
    expect(app.filterChanged("completed")).toBe(false);
    expect(await app.toggleTodo("1", true)).toBeUndefined();
    script.expectNoCalls();

    kernel.resume();
    await script.expectCall("api.getTodos"); // live again: the projection re-asks the server
    await script.resolve("api.getTodos", [one]);
    expect(app.state.filter).toBe("active");
    expect(rows(app)).toEqual(["1:open:toggleTodo"]);
    expectReplayable(kernel);
  });
});
