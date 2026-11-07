// The todos feature: client state (a slice), server data (derived), and the
// named actions that change the server. Same three layers as the original:
//
//   3. Optimistic: writes inside actions, reverted when each action settles.
//   2. Errors: failed saves, from the slice, applied under the optimistic layer.
//   1. Server: api.getTodos(), re-asked with refresh() after every save.
import { createOptimisticStore, createProjection, refresh } from "solid-js";
import { feature } from "@solidkit/slices";
import type { api as realApi, Todo as ServerTodo } from "./api";
import { parseHash, todosSlice, withErrors, type Todo } from "./state";

export const Todos = feature((kit, api: typeof realApi, hash: string) => {
  const [state, { filterChanged, saved, failed }] = kit.use(todosSlice, { ...todosSlice.initial, filter: parseHash(hash) });
  const services = kit.services({ api });

  const server = createProjection<ServerTodo[]>(() => services.api.getTodos(), [], { key: "id" });
  const [todos, setTodos] = createOptimisticStore<Todo[]>(() => withErrors(server, state.errors), [], { key: "id" });
  kit.refreshable(server);

  const addTodo = kit.action("addTodo", function* (todo: ServerTodo) {
    setTodos(t => {
      const old = t.find(x => x.id === todo.id);
      if (old) old.pending = true;
      else t.push({ ...todo, pending: true });
    });
    try {
      yield services.api.addTodo(todo);
      saved([todo.id]);
    } catch {
      failed([todo.id], { type: "addTodo", todo });
    }
    refresh(server);
  });

  const removeTodo = kit.action("removeTodo", function* (id: string) {
    setTodos(t => t.filter(todo => todo.id !== id));
    try {
      yield services.api.removeTodo(id);
      saved([id]);
    } catch {
      failed([id], { type: "removeTodo" });
    }
    refresh(server);
  });

  const toggleTodo = kit.action("toggleTodo", function* (id: string, completed: boolean) {
    setTodos(t => {
      const todo = t.find(x => x.id === id);
      if (todo) Object.assign(todo, { completed, pending: true });
    });
    try {
      yield services.api.toggleTodo(id, completed);
      saved([id]);
    } catch {
      failed([id], { type: "toggleTodo", completed });
    }
    refresh(server);
  });

  const toggleAll = kit.action("toggleAll", function* (completed: boolean) {
    const ids = todos.filter(t => t.completed !== completed).map(t => t.id);
    setTodos(t => {
      for (const todo of t) if (ids.includes(todo.id)) Object.assign(todo, { completed, pending: true });
    });
    try {
      yield services.api.toggleAll(ids, completed);
      saved(ids);
    } catch {
      failed(ids, { type: "toggleTodo", completed }); // fans out: every item gets its own retry
    }
    refresh(server);
  });

  const clearCompleted = kit.action("clearCompleted", function* () {
    const ids = todos.filter(t => t.completed).map(t => t.id);
    setTodos(t => t.filter(todo => !todo.completed));
    try {
      yield services.api.clearCompleted(ids);
      saved(ids);
    } catch {
      failed(ids, { type: "removeTodo" });
    }
    refresh(server);
  });

  function retryTodo(todo: Todo) {
    const error = todo.error;
    if (error?.type === "addTodo") return addTodo(error.todo);
    if (error?.type === "toggleTodo") return toggleTodo(todo.id, error.completed);
    if (error?.type === "removeTodo") return removeTodo(todo.id);
  }

  return {
    state,
    todos,
    filterChanged,
    addTodo,
    removeTodo,
    toggleTodo,
    toggleAll,
    clearCompleted,
    retryTodo,
    /** Re-asks the server (the error boundary's reset). */
    reload: () => refresh(server)
  };
});

export type TodosApp = ReturnType<typeof Todos.create>;
