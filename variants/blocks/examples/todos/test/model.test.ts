// Pure tests of the state logic: no Solid, no services.
import { describe, expect, test } from "vitest";
import { testOut, testUpdate } from "@solidkit/blocks/testing";
import { App } from "../src/app.tsx";
import { Msg as NewTodoMsg, NewTodo } from "../src/new-todo.tsx";
import { Act, Msg, TodoList, withFailures, type Model, type Todo } from "../src/todo-list.tsx";

const list = (todos: Todo[]) => ({ todos }); // update reads data.todos only
const model = (failures: Model["failures"] = {}): Model => ({ filter: "all", failures });

describe("NewTodo", () => {
  test("typing edits the draft; Enter trims it, clears it and reports the title", () => {
    let r = testUpdate(NewTodo, { text: "" }, NewTodoMsg.ChangedText({ text: "  Write the RFC " }));
    expect(r.model.text).toBe("  Write the RFC ");
    r = testUpdate(NewTodo, r.model, NewTodoMsg.Submitted({ id: "7" }));
    expect(r.model.text).toBe("");
    expect(r.outs).toEqual([{ type: "EnteredTitle", id: "7", title: "Write the RFC" }]);
  });

  test("a blank draft reports nothing", () => {
    expect(testUpdate(NewTodo, { text: "   " }, NewTodoMsg.Submitted({ id: "1" })).outs).toEqual([]);
  });
});

describe("the root", () => {
  test("an entered title becomes TodoList's add operation", () => {
    const r = testOut(App, "header", { type: "EnteredTitle", id: "7", title: "x" }, {
      header: { text: "" },
      list: model()
    });
    expect(r.ops).toEqual([{ block: "list", op: "add", args: [{ id: "7", title: "x" }] }]);
  });
});

describe("TodoList", () => {
  const a: Todo = { id: "a", title: "A", completed: false };
  const b: Todo = { id: "b", title: "B", completed: true };

  test("each user intent becomes one action request", () => {
    expect(testUpdate(TodoList, model(), Msg.RequestedAdd({ id: "c", title: "C" })).acts).toEqual([
      Act.addTodo({ todo: { id: "c", title: "C", completed: false } })
    ]);
    expect(testUpdate(TodoList, model(), Msg.ToggledTodo({ id: "a", completed: true })).acts).toEqual([
      Act.toggleTodo({ id: "a", completed: true })
    ]);
    expect(testUpdate(TodoList, model(), Msg.ClickedDestroy({ id: "a" })).acts).toEqual([Act.removeTodo({ id: "a" })]);
  });

  test("toggle-all and clear-completed pick their ids from the list as shown", () => {
    const data = list([a, b]);
    expect(testUpdate(TodoList, model(), Msg.ToggledAll({ completed: true }), { data }).acts).toEqual([
      Act.toggleAll({ ids: ["a"], completed: true })
    ]);
    expect(testUpdate(TodoList, model(), Msg.ClickedClearCompleted(), { data }).acts).toEqual([Act.clearCompleted({ ids: ["b"] })]);
  });

  test("bulk failures fan out to one retry per todo; an earlier add failure wins", () => {
    const r = testUpdate(
      TodoList,
      model({ c: { op: "addTodo", title: "C" } }),
      Msg.SaveFailed({ act: Act.toggleAll({ ids: ["a", "c"], completed: true }) })
    );
    expect(r.model.failures).toEqual({ a: { op: "toggleTodo", completed: true }, c: { op: "addTodo", title: "C" } });
  });

  test("retry repeats what failed; a successful save clears the failure", () => {
    const failed = model({ a: { op: "toggleTodo", completed: true }, c: { op: "addTodo", title: "C" } });
    expect(testUpdate(TodoList, failed, Msg.ClickedRetry({ id: "c" })).acts).toEqual([
      Act.addTodo({ todo: { id: "c", title: "C", completed: false } })
    ]);
    expect(testUpdate(TodoList, failed, Msg.ClickedRetry({ id: "a" })).acts).toEqual([Act.toggleTodo({ id: "a", completed: true })]);
    expect(testUpdate(TodoList, failed, Msg.ClickedRetry({ id: "zzz" })).acts).toEqual([]);
    const r = testUpdate(TodoList, failed, Msg.Saved({ act: Act.toggleTodo({ id: "a", completed: true }) }));
    expect(r.model.failures).toEqual({ c: { op: "addTodo", title: "C" } });
  });

  test("the hash picks the filter", () => {
    expect(testUpdate(TodoList, model(), Msg.ChangedHash({ hash: "#/completed" })).model.filter).toBe("completed");
    expect(testUpdate(TodoList, model(), Msg.ChangedHash({ hash: "#/nope" })).model.filter).toBe("all");
  });

  test("failures are layered over server todos; failed adds keep their place", () => {
    expect(withFailures([a, b], { b: { op: "removeTodo" }, ab: { op: "addTodo", title: "AB" } })).toEqual([
      a,
      { id: "ab", title: "AB", completed: false, error: "addTodo" },
      { ...b, error: "removeTodo" }
    ]);
  });
});
