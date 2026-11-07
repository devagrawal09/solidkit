// Pure tests: the slice's mutations and the list derivation. No Solid, no kernel.
import { describe, expect, test } from "vitest";
import { given } from "@solidkit/slices/testing";
import { parseHash, todosSlice, withErrors } from "../src/state";

const a = { id: "1", title: "Write the RFC", completed: false };
const b = { id: "3", title: "Ship it", completed: true };

describe("todos slice", () => {
  test("the hash picks the filter", () => {
    expect(parseHash("#/active")).toBe("active");
    expect(parseHash("#/completed")).toBe("completed");
    expect(parseHash("")).toBe("all");
    const [state, { filterChanged }] = given(todosSlice);
    filterChanged("completed");
    expect(state.filter).toBe("completed");
  });

  test("a failure fans out to one retry per item and keeps the first failure", () => {
    const [state, { failed }] = given(todosSlice);
    failed(["1", "3"], { type: "toggleTodo", completed: true });
    failed(["1"], { type: "removeTodo" });
    expect(state.errors).toEqual({
      "1": { type: "toggleTodo", completed: true },
      "3": { type: "toggleTodo", completed: true }
    });
  });

  test("a successful save clears the item's error", () => {
    const [state, { failed, saved }] = given(todosSlice);
    failed(["1", "3"], { type: "removeTodo" });
    saved(["3"]);
    expect(Object.keys(state.errors)).toEqual(["1"]);
  });
});

describe("the list", () => {
  test("server todos carry their errors", () => {
    expect(withErrors([a, b], { "3": { type: "removeTodo" } })).toEqual([a, { ...b, error: { type: "removeTodo" } }]);
  });

  test("a failed add stays visible, in id order, until the server has it", () => {
    const added = { id: "2", title: "Draft", completed: false };
    const error = { type: "addTodo" as const, todo: added };
    expect(withErrors([a, b], { "2": error }).map(t => t.id)).toEqual(["1", "2", "3"]);
    expect(withErrors([a, b], { "2": error })[1]).toEqual({ ...added, error });
    expect(withErrors([a, added, b], { "2": error }).filter(t => t.id === "2")).toHaveLength(1);
  });
});
