import { describe, expect, test } from "vitest";
import { expectActions, expectModel, send, story } from "@solidkit/messages/testing";
import { Act, init, Msg, update, withFailedAdds, type Model, type Todo } from "../src/todos.ts";

const todo = (id: string, title: string, completed = false): Todo => ({ id, title, completed });
const server = { todos: [todo("1", "Write the RFC"), todo("2", "Ship it", true)] };
const given = (model: Partial<Model> = {}) => ({ model: { ...init("#/"), ...model }, data: server });
const expectFailures = (failures: Model["failures"]) => expectModel<Model>(m => expect(m.failures).toEqual(failures));

describe("todos update", () => {
  test("the hash picks the filter", () => {
    expect(init("#/active").filter).toBe("active");
    story({ update }, given(), send(Msg.ChangedHash({ hash: "#/completed" })), expectModel<Model>(m => expect(m.filter).toBe("completed")));
    story({ update }, given(), send(Msg.ChangedHash({ hash: "#/nope" })), expectModel<Model>(m => expect(m.filter).toBe("all")));
  });

  test("submitting the draft clears it and requests an add; a blank draft does nothing", () => {
    story(
      { update },
      given(),
      send(Msg.UpdatedDraft({ text: "  Buy milk " }), Msg.SubmittedDraft({ id: "3" })),
      expectModel<Model>(m => expect(m.draft).toBe("")),
      expectActions(Act.addTodo({ todo: todo("3", "Buy milk") })),
      send(Msg.UpdatedDraft({ text: "   " }), Msg.SubmittedDraft({ id: "4" })),
      expectActions()
    );
  });

  test("a failed toggle is remembered per item and retried as the same action", () => {
    story(
      { update },
      given(),
      send(Msg.ToggledTodo({ id: "1", completed: true })),
      expectActions(Act.toggleTodo({ id: "1", completed: true })),
      send(Msg.FailedToSave({ act: Act.toggleTodo({ id: "1", completed: true }) })),
      expectFailures({ "1": Act.toggleTodo({ id: "1", completed: true }) }),
      send(Msg.ClickedRetry({ id: "1" })),
      expectActions(Act.toggleTodo({ id: "1", completed: true })),
      // the failure stays until a save succeeds
      expectFailures({ "1": Act.toggleTodo({ id: "1", completed: true }) }),
      send(Msg.SavedTodos({ ids: ["1"] })),
      expectFailures({})
    );
  });

  test("the first failure wins: a failed add is not replaced by a later failure", () => {
    const add = Act.addTodo({ todo: todo("3", "Buy milk") });
    story(
      { update },
      given(),
      send(Msg.FailedToSave({ act: add }), Msg.FailedToSave({ act: Act.toggleTodo({ id: "3", completed: true }) })),
      expectFailures({ "3": add })
    );
  });

  test("destroying a failed add only forgets it; destroying a saved todo asks the server", () => {
    const add = Act.addTodo({ todo: todo("3", "Buy milk") });
    story(
      { update },
      given({ failures: { "3": add } }),
      send(Msg.ClickedDestroy({ id: "3" })),
      expectActions(),
      expectFailures({}),
      send(Msg.ClickedDestroy({ id: "1" })),
      expectActions(Act.removeTodo({ id: "1" }))
    );
  });

  test("toggle-all asks for the todos that change, and its failure fans out to per-item retries", () => {
    story(
      { update },
      given(),
      send(Msg.ToggledAll({ completed: true })),
      expectActions(Act.toggleAll({ ids: ["1"], completed: true })),
      send(Msg.FailedToSave({ act: Act.toggleAll({ ids: ["1"], completed: true }) })),
      expectFailures({ "1": Act.toggleTodo({ id: "1", completed: true }) })
    );
  });

  test("clear-completed asks for the completed ids, and its failure fans out to per-item removes", () => {
    story(
      { update },
      given(),
      send(Msg.ClickedClearCompleted()),
      expectActions(Act.clearCompleted({ ids: ["2"] })),
      send(Msg.FailedToSave({ act: Act.clearCompleted({ ids: ["2"] }) })),
      expectFailures({ "2": Act.removeTodo({ id: "2" }) })
    );
  });

  test("failed adds are shown in id order, once", () => {
    const failures = { "15": Act.addTodo({ todo: todo("15", "b") }), "3": Act.addTodo({ todo: todo("3", "z") }) };
    const list = [todo("1", "a"), todo("2", "c")];
    expect(withFailedAdds(list, failures).map(t => t.id)).toEqual(["1", "15", "2", "3"]);
    // while a retry is in flight the optimistic copy is in the list: no duplicate
    expect(withFailedAdds([...list, todo("3", "z")], failures).map(t => t.id)).toEqual(["1", "15", "2", "3"]);
  });
});
