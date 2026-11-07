// The todos program: client state, messages, update, data and actions.
//
// Layers, as in the Solid original, but split by who owns them:
//   - server truth + optimistic overlay: `todos`, an optimistic store over api.getTodos
//     (data). Handlers write it optimistically; it reverts when their transition lands.
//   - client state: the model (filter, draft, per-item failures). Only update writes it.
//   - what the list shows: `items`, a memo merging the two (failed adds stay visible).
import { createMemo, createOptimisticStore, refresh } from "solid-js";
import { onWindow, variants, type Handlers, type ProgramSpec } from "@solidkit/messages";
import type { api, Todo as ServerTodo } from "./api.ts";

export type Services = { api: typeof api };
export type Filter = "all" | "active" | "completed";
/** A todo as shown: server truth, plus `pending` while an optimistic write is in flight. */
export type Todo = ServerTodo & { pending?: boolean };

export type Model = {
  filter: Filter;
  draft: string;
  /** Failed saves by todo id: the per-item action to retry. The first failure wins. */
  failures: Record<string, Retry>;
};

export const parseHash = (hash: string): Filter =>
  hash === "#/active" ? "active" : hash === "#/completed" ? "completed" : "all";

export const init = (hash: string): Model => ({ filter: parseHash(hash), draft: "", failures: {} });

// ── Messages (facts) and actions (requested mutations) ───────────────────────

export type Msg =
  | { type: "ChangedHash"; hash: string }
  | { type: "UpdatedDraft"; text: string }
  | { type: "SubmittedDraft"; id: string }
  | { type: "ToggledTodo"; id: string; completed: boolean }
  | { type: "ClickedDestroy"; id: string }
  | { type: "ClickedRetry"; id: string }
  | { type: "ToggledAll"; completed: boolean }
  | { type: "ClickedClearCompleted" }
  | { type: "SavedTodos"; ids: string[] }
  | { type: "FailedToSave"; act: Act };
export const Msg = variants<Msg>();

export type Act =
  | { type: "addTodo"; todo: ServerTodo }
  | { type: "toggleTodo"; id: string; completed: boolean }
  | { type: "removeTodo"; id: string }
  | { type: "toggleAll"; ids: string[]; completed: boolean }
  | { type: "clearCompleted"; ids: string[] };
export const Act = variants<Act>();

/** The per-item actions a failure can be retried with. */
export type Retry = Extract<Act, { type: "addTodo" | "toggleTodo" | "removeTodo" }>;

// ── Update: decides what happens; never waits ─────────────────────────────────

/** What update reads from data: plain values, so story tests can pass a fixture. */
export type Reads = { readonly todos: readonly Todo[] };

export function update(model: Model, msg: Msg, data: Reads): Act | void {
  switch (msg.type) {
    case "ChangedHash":
      model.filter = parseHash(msg.hash);
      return;
    case "UpdatedDraft":
      model.draft = msg.text;
      return;
    case "SubmittedDraft": {
      const title = model.draft.trim();
      if (!title) return;
      model.draft = "";
      return Act.addTodo({ todo: { id: msg.id, title, completed: false } });
    }
    case "ToggledTodo":
      return Act.toggleTodo({ id: msg.id, completed: msg.completed });
    case "ClickedDestroy":
      // A failed add never reached the server: forgetting it is all there is to do.
      if (model.failures[msg.id]?.type === "addTodo") {
        delete model.failures[msg.id];
        return;
      }
      return Act.removeTodo({ id: msg.id });
    case "ClickedRetry":
      return model.failures[msg.id]; // the failure is the action to run again
    case "ToggledAll": {
      const ids = data.todos.filter(t => t.completed !== msg.completed).map(t => t.id);
      return Act.toggleAll({ ids, completed: msg.completed });
    }
    case "ClickedClearCompleted":
      return Act.clearCompleted({ ids: data.todos.filter(t => t.completed).map(t => t.id) });
    case "SavedTodos":
      for (const id of msg.ids) delete model.failures[id];
      return;
    case "FailedToSave":
      for (const [id, retry] of retriesFor(msg.act)) model.failures[id] ??= retry;
      return;
  }
}

/** Bulk failures fan out, so every item gets its own retry. */
function retriesFor(act: Act): [string, Retry][] {
  switch (act.type) {
    case "addTodo":
      return [[act.todo.id, act]];
    case "toggleTodo":
    case "removeTodo":
      return [[act.id, act]];
    case "toggleAll":
      return act.ids.map(id => [id, Act.toggleTodo({ id, completed: act.completed })]);
    case "clearCompleted":
      return act.ids.map(id => [id, Act.removeTodo({ id })]);
  }
}

// ── Data: server truth, derived, with an optimistic overlay ───────────────────

export function data(model: Model, { api }: Services) {
  const [todos, setTodos] = createOptimisticStore<Todo[]>(() => api.getTodos(), []);
  /** The list as shown: server todos plus failed adds (the server never saw them), by id. */
  const items = createMemo(() => withFailedAdds(todos, model.failures));
  return { todos, setTodos, items };
}
export type Data = ReturnType<typeof data>;

export function withFailedAdds(todos: readonly Todo[], failures: Record<string, Retry>): Todo[] {
  const list = [...todos];
  for (const retry of Object.values(failures)) {
    if (retry.type !== "addTodo" || list.some(t => t.id === retry.todo.id)) continue;
    const at = list.findIndex(t => t.id > retry.todo.id);
    if (at < 0) list.push(retry.todo);
    else list.splice(at, 0, retry.todo);
  }
  return list;
}

// ── Actions: optimistic write, yield the request, refresh, report the fact ────

export const actions = ({ todos, setTodos }: Data, { api }: Services): Handlers<Act, Msg> => ({
  *addTodo({ todo }) {
    setTodos(list => {
      const old = list.find(t => t.id === todo.id);
      if (old) old.pending = true;
      else list.push({ ...todo, pending: true });
    });
    yield api.addTodo(todo);
    refresh(todos);
    return Msg.SavedTodos({ ids: [todo.id] });
  },
  *toggleTodo({ id, completed }) {
    setTodos(list => {
      const todo = list.find(t => t.id === id);
      if (todo) Object.assign(todo, { completed, pending: true });
    });
    yield api.toggleTodo(id, completed);
    refresh(todos);
    return Msg.SavedTodos({ ids: [id] });
  },
  *removeTodo({ id }) {
    setTodos(list => list.filter(t => t.id !== id));
    yield api.removeTodo(id);
    refresh(todos);
    return Msg.SavedTodos({ ids: [id] });
  },
  *toggleAll({ ids, completed }) {
    const set = new Set(ids);
    setTodos(list => {
      for (const todo of list) if (set.has(todo.id)) Object.assign(todo, { completed, pending: true });
    });
    yield api.toggleAll(ids, completed);
    refresh(todos);
    return Msg.SavedTodos({ ids });
  },
  *clearCompleted({ ids }) {
    const set = new Set(ids);
    setTodos(list => list.filter(t => !set.has(t.id)));
    yield api.clearCompleted(ids);
    refresh(todos);
    return Msg.SavedTodos({ ids });
  }
});

export const todos: ProgramSpec<Model, Msg, Act, Data, Services, string> = {
  name: "todos",
  init,
  update,
  data,
  sources: data => [data.todos],
  actions,
  // A failed save becomes a fact; it lands with the optimistic revert.
  onActionError: act => Msg.FailedToSave({ act }),
  subscriptions: () => [onWindow("hashchange", () => Msg.ChangedHash({ hash: location.hash }))]
};
