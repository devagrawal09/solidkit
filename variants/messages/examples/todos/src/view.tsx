import { Errored, For, Loading, Show } from "solid-js";
import { program, type Send, type View } from "@solidkit/messages";
import { Msg, todos, type Data, type Filter, type Model, type Retry, type Todo } from "./todos.ts";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function Header(props: { draft: string; send: Send<Msg> }) {
  return (
    <header class="header">
      <h1>todos</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus
        value={props.draft}
        onInput={e => props.send(Msg.UpdatedDraft({ text: e.currentTarget.value }))}
        onKeyDown={e => {
          if (e.key === "Enter") props.send(Msg.SubmittedDraft({ id: newId() }));
        }}
      />
    </header>
  );
}

function TodoItem(props: { todo: Todo; failure: Retry | undefined; send: Send<Msg> }) {
  return (
    <li class={["todo", { completed: props.todo.completed, pending: !!props.todo.pending, errored: !!props.failure }]}>
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={props.todo.completed}
          onChange={e => props.send(Msg.ToggledTodo({ id: props.todo.id, completed: e.currentTarget.checked }))}
        />
        <label>{props.todo.title}</label>
        <Show when={props.failure}>
          {failure => (
            <button
              class="retry"
              title={`Retry ${failure().type}`}
              onClick={() => props.send(Msg.ClickedRetry({ id: props.todo.id }))}
            />
          )}
        </Show>
        <button class="destroy" onClick={() => props.send(Msg.ClickedDestroy({ id: props.todo.id }))} />
      </div>
    </li>
  );
}

function MainSection(props: { items: Todo[]; filter: Filter; failures: Model["failures"]; send: Send<Msg> }) {
  const filtered = () => {
    if (props.filter === "active") return props.items.filter(t => !t.completed);
    if (props.filter === "completed") return props.items.filter(t => t.completed);
    return props.items;
  };
  const allCompleted = () => props.items.length > 0 && props.items.every(t => t.completed);
  return (
    <Show when={props.items.length > 0}>
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
          <For each={filtered()}>
            {todo => <TodoItem todo={todo} failure={props.failures[todo.id]} send={props.send} />}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function Footer(props: { items: Todo[]; filter: Filter; send: Send<Msg> }) {
  const remaining = () => props.items.filter(t => !t.completed).length;
  const completed = () => props.items.length - remaining();
  return (
    <Show when={props.items.length > 0}>
      <footer class="footer">
        <span class="todo-count">
          <strong>{remaining()}</strong> {remaining() === 1 ? "item" : "items"} left
        </span>
        <ul class="filters">
          <li>
            <a href="#/" class={{ selected: props.filter === "all" }}>
              All
            </a>
          </li>
          <li>
            <a href="#/active" class={{ selected: props.filter === "active" }}>
              Active
            </a>
          </li>
          <li>
            <a href="#/completed" class={{ selected: props.filter === "completed" }}>
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

export const view: View<Model, Msg, Data> = (model, send, { items }) => (
  <Errored
    fallback={(err, reset) => (
      <div class="app-error">
        <p>Something went wrong: {String(err())}</p>
        <button onClick={reset}>Reset</button>
      </div>
    )}
  >
    <section class="todoapp">
      <Header draft={model.draft} send={send} />
      <Loading fallback={<p class="loading">Loading…</p>}>
        <MainSection items={items()} filter={model.filter} failures={model.failures} send={send} />
        <Footer items={items()} filter={model.filter} send={send} />
      </Loading>
    </section>
  </Errored>
);

export const App = program({ ...todos, view });
