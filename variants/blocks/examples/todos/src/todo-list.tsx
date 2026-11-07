// TodoList: the list, its filters and every save. Server todos are derived
// (an optimistic store over api.getTodos); the model holds only what the user
// chose (the filter) and what went wrong (one failure per todo, for retry).
import { createOptimisticStore, createProjection, For, refresh, Show } from "solid-js";
import { block, variants, type DataCtx, type Handlers, type Send, type ViewProps } from "@solidkit/blocks";
import type { Api, Todo as ServerTodo } from "./api.ts";

export type Filter = "all" | "active" | "completed";
export const parseHash = (hash: string): Filter =>
  hash === "#/active" ? "active" : hash === "#/completed" ? "completed" : "all";

/** Why a todo's last save failed, kept until a save of it succeeds. */
export type Failure = { op: "addTodo"; title: string } | { op: "toggleTodo"; completed: boolean } | { op: "removeTodo" };

export type Model = { filter: Filter; failures: Record<string, Failure> };

/** A todo as shown: server truth, optimistic `pending`, and the last failure. */
export type Todo = ServerTodo & { pending?: boolean; error?: Failure["op"] };

export type Msg =
  | { type: "ChangedHash"; hash: string }
  | { type: "RequestedAdd"; id: string; title: string }
  | { type: "ToggledTodo"; id: string; completed: boolean }
  | { type: "ClickedDestroy"; id: string }
  | { type: "ClickedRetry"; id: string }
  | { type: "ToggledAll"; completed: boolean }
  | { type: "ClickedClearCompleted" }
  | { type: "Saved"; act: Act }
  | { type: "SaveFailed"; act: Act };
export const Msg = variants<Msg>();

export type Act =
  | { type: "addTodo"; todo: ServerTodo }
  | { type: "toggleTodo"; id: string; completed: boolean }
  | { type: "removeTodo"; id: string }
  | { type: "toggleAll"; ids: string[]; completed: boolean }
  | { type: "clearCompleted"; ids: string[] };
export const Act = variants<Act>();

type Services = { api: Api };
type Types = { model: Model; msg: Msg; act: Act; services: Services; args: { hash: string } };

// ── Data: server truth with an optimistic overlay, failures layered on top ───

export function data(model: Model, { api }: Services, ctx: DataCtx) {
  const [server, setServer] = createOptimisticStore<Todo[]>(() => api.getTodos(), []);
  ctx.refreshable(server);
  const todos = createProjection<Todo[]>(() => withFailures(server, model.failures), [], { key: "id" });
  return { server, setServer, todos };
}
export type Data = ReturnType<typeof data>;

/** What the list shows: each todo with its failure; failed adds stay, in id order. */
export function withFailures(server: readonly Todo[], failures: Record<string, Failure>): Todo[] {
  const list: Todo[] = server.map(t => (failures[t.id] ? { ...t, error: failures[t.id].op } : { ...t }));
  for (const [id, failure] of Object.entries(failures)) {
    if (failure.op !== "addTodo" || list.some(t => t.id === id)) continue;
    const todo: Todo = { id, title: failure.title, completed: false, error: "addTodo" };
    const index = list.findIndex(t => t.id > id);
    if (index > -1) list.splice(index, 0, todo);
    else list.push(todo);
  }
  return list;
}

// ── Update: decides; never waits ────────────────────────────────────────────

export function update(model: Model, msg: Msg, ctx: { data: Data }): Act | void {
  switch (msg.type) {
    case "ChangedHash":
      model.filter = parseHash(msg.hash);
      return;
    case "RequestedAdd":
      return Act.addTodo({ todo: { id: msg.id, title: msg.title, completed: false } });
    case "ToggledTodo":
      return Act.toggleTodo({ id: msg.id, completed: msg.completed });
    case "ClickedDestroy":
      return Act.removeTodo({ id: msg.id });
    case "ClickedRetry": {
      const failure = model.failures[msg.id];
      return failure && retry(msg.id, failure);
    }
    case "ToggledAll": {
      const ids = ctx.data.todos.filter(t => t.completed !== msg.completed).map(t => t.id);
      return Act.toggleAll({ ids, completed: msg.completed });
    }
    case "ClickedClearCompleted":
      return Act.clearCompleted({ ids: ctx.data.todos.filter(t => t.completed).map(t => t.id) });
    case "Saved":
      for (const [id] of failuresOf(msg.act)) delete model.failures[id];
      return;
    case "SaveFailed":
      // The first failure wins: a todo whose add failed stays an add to retry.
      for (const [id, failure] of failuresOf(msg.act)) model.failures[id] ??= failure;
      return;
  }
}

const retry = (id: string, failure: Failure): Act =>
  failure.op === "addTodo"
    ? Act.addTodo({ todo: { id, title: failure.title, completed: false } })
    : failure.op === "toggleTodo"
      ? Act.toggleTodo({ id, completed: failure.completed })
      : Act.removeTodo({ id });

/** Bulk failures fan out, so every item gets its own retry. */
export function failuresOf(act: Act): [string, Failure][] {
  switch (act.type) {
    case "addTodo":
      return [[act.todo.id, { op: "addTodo", title: act.todo.title }]];
    case "toggleTodo":
      return [[act.id, { op: "toggleTodo", completed: act.completed }]];
    case "removeTodo":
      return [[act.id, { op: "removeTodo" }]];
    case "toggleAll":
      return act.ids.map(id => [id, { op: "toggleTodo", completed: act.completed }]);
    case "clearCompleted":
      return act.ids.map(id => [id, { op: "removeTodo" }]);
  }
}

// ── Actions: Solid actions. Optimistic write, yield the request, refresh ─────

export const actions = ({ server, setServer }: Data, { api }: Services, { send }: { send: Send<Msg> }): Handlers<Act> => ({
  *addTodo(act) {
    setServer(t => {
      const old = t.find(x => x.id === act.todo.id);
      if (old) old.pending = true;
      else t.push({ ...act.todo, pending: true });
    });
    try {
      yield api.addTodo(act.todo);
      send(Msg.Saved({ act }));
    } finally {
      refresh(server);
    }
  },
  *toggleTodo(act) {
    setServer(t => {
      const todo = t.find(x => x.id === act.id);
      if (todo) Object.assign(todo, { completed: act.completed, pending: true });
    });
    try {
      yield api.toggleTodo(act.id, act.completed);
      send(Msg.Saved({ act }));
    } finally {
      refresh(server);
    }
  },
  *removeTodo(act) {
    setServer(t => t.filter(x => x.id !== act.id));
    try {
      yield api.removeTodo(act.id);
      send(Msg.Saved({ act }));
    } finally {
      refresh(server);
    }
  },
  *toggleAll(act) {
    const ids = new Set(act.ids);
    setServer(t => {
      for (const todo of t) if (ids.has(todo.id)) Object.assign(todo, { completed: act.completed, pending: true });
    });
    try {
      yield api.toggleAll(act.ids, act.completed);
      send(Msg.Saved({ act }));
    } finally {
      refresh(server);
    }
  },
  *clearCompleted(act) {
    const ids = new Set(act.ids);
    setServer(t => t.filter(x => !ids.has(x.id)));
    try {
      yield api.clearCompleted(act.ids);
      send(Msg.Saved({ act }));
    } finally {
      refresh(server);
    }
  }
});

// ── View: the original TodoMVC markup ───────────────────────────────────────

function TodoItem(props: { todo: Todo; send: Send<Msg> }) {
  return (
    <li class={["todo", { completed: props.todo.completed, pending: !!props.todo.pending, errored: !!props.todo.error }]}>
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={props.todo.completed}
          onChange={e => props.send(Msg.ToggledTodo({ id: props.todo.id, completed: e.currentTarget.checked }))}
        />
        <label>{props.todo.title}</label>
        <Show when={props.todo.error}>
          {error => <button class="retry" title={`Retry ${error()}`} onClick={() => props.send(Msg.ClickedRetry({ id: props.todo.id }))} />}
        </Show>
        <button class="destroy" onClick={() => props.send(Msg.ClickedDestroy({ id: props.todo.id }))} />
      </div>
    </li>
  );
}

function view(props: ViewProps<Types, {}, Data>) {
  const todos = () => props.data.todos;
  const filtered = () => {
    const f = props.model.filter;
    if (f === "active") return todos().filter(x => !x.completed);
    if (f === "completed") return todos().filter(x => x.completed);
    return todos();
  };
  const allCompleted = () => todos().length > 0 && todos().every(x => x.completed);
  const remaining = () => todos().filter(x => !x.completed).length;
  const completed = () => todos().length - remaining();
  return (
    <Show when={todos().length > 0}>
      <section class="main">
        <input
          id="toggle-all"
          class="toggle-all"
          type="checkbox"
          checked={allCompleted()}
          onChange={() => props.send(Msg.ToggledAll({ completed: !allCompleted() }))}
        />
        <label for="toggle-all">Mark all as complete</label>
        <ul class="todo-list">
          <For each={filtered()}>{todo => <TodoItem todo={todo} send={props.send} />}</For>
        </ul>
      </section>
      <footer class="footer">
        <span class="todo-count">
          <strong>{remaining()}</strong> {remaining() === 1 ? "item" : "items"} left
        </span>
        <ul class="filters">
          <li>
            <a href="#/" class={{ selected: props.model.filter === "all" }}>
              All
            </a>
          </li>
          <li>
            <a href="#/active" class={{ selected: props.model.filter === "active" }}>
              Active
            </a>
          </li>
          <li>
            <a href="#/completed" class={{ selected: props.model.filter === "completed" }}>
              Completed
            </a>
          </li>
        </ul>
        <Show when={completed() > 0}>
          <button class="clear-completed" onClick={() => props.send(Msg.ClickedClearCompleted())}>
            Clear completed
          </button>
        </Show>
      </footer>
    </Show>
  );
}

export const TodoList = block<Types>()({
  name: "TodoList",
  requires: { api: true },
  init: args => ({ filter: parseHash(args.hash), failures: {} }),
  data,
  update,
  actions,
  onActionError: act => Msg.SaveFailed({ act }),
  subscriptions: () => [
    {
      key: "hashchange",
      start: send => {
        const listener = () => send(Msg.ChangedHash({ hash: location.hash }));
        window.addEventListener("hashchange", listener);
        return () => window.removeEventListener("hashchange", listener);
      }
    }
  ],
  operations: { add: (todo: { id: string; title: string }) => Msg.RequestedAdd(todo) },
  view
});
