// Client state for todos: one slice, changed only by the named mutations below.
// Server data is not here; it is derived in todos.ts.
import { slice } from "@solidkit/slices";
import type { Todo as ServerTodo } from "./api";

export type Filter = "all" | "active" | "completed";

/** A save that failed, kept so the item can offer a retry. */
export type TodoError =
  | { type: "addTodo"; todo: ServerTodo }
  | { type: "toggleTodo"; completed: boolean }
  | { type: "removeTodo" };

export type TodosState = {
  filter: Filter;
  /** Failed saves by todo id. */
  errors: Record<string, TodoError>;
};

const initial: TodosState = { filter: "all", errors: {} };

export const todosSlice = slice("todos", initial, {
  /** The URL hash changed. */
  filterChanged(state, filter: Filter) {
    state.filter = filter;
  },
  /** Saves for these todos went through. */
  saved(state, ids: string[]) {
    for (const id of ids) delete state.errors[id];
  },
  /** Saves failed: each todo gets its own retry. The first failure is kept. */
  failed(state, ids: string[], error: TodoError) {
    for (const id of ids) state.errors[id] ??= { ...error };
  }
});

export function parseHash(hash: string): Filter {
  if (hash === "#/active") return "active";
  if (hash === "#/completed") return "completed";
  return "all";
}

export interface Todo extends ServerTodo {
  pending?: boolean;
  error?: TodoError;
}

/**
 * The list as the user sees it: server todos with their errors, plus failed
 * adds (the server never got them) in id order.
 */
export function withErrors(server: readonly ServerTodo[], errors: Record<string, TodoError>): Todo[] {
  const todos: Todo[] = server.map(t => (errors[t.id] ? { ...t, error: errors[t.id] } : { ...t }));
  for (const [id, error] of Object.entries(errors)) {
    if (error.type !== "addTodo" || todos.some(t => t.id === id)) continue;
    const index = todos.findIndex(t => t.id > id);
    todos.splice(index < 0 ? todos.length : index, 0, { ...error.todo, error });
  }
  return todos;
}
