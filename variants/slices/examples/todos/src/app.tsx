import { createEffect, Errored, For, Loading, onSettled, Show } from "solid-js";
import { parseHash, type Todo } from "./state";
import { Todos, type TodosApp } from "./todos";

function Header() {
  const { addTodo } = Todos.use();
  return (
    <header class="header">
      <h1>todos</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          const title = e.currentTarget.value.trim();
          if (!title) return;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          addTodo({ id, title, completed: false });
          e.currentTarget.value = "";
        }}
      />
    </header>
  );
}

function TodoItem(props: { todo: Todo }) {
  const { toggleTodo, removeTodo, retryTodo } = Todos.use();
  return (
    <li
      class={[
        "todo",
        {
          completed: props.todo.completed,
          pending: !!props.todo.pending,
          errored: !!props.todo.error
        }
      ]}
    >
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={props.todo.completed}
          onChange={e => toggleTodo(props.todo.id, e.currentTarget.checked)}
        />
        <label>{props.todo.title}</label>
        <Show when={props.todo.error}>
          {error => <button class="retry" title={`Retry ${error().type}`} onClick={() => retryTodo(props.todo)} />}
        </Show>
        <button class="destroy" onClick={() => removeTodo(props.todo.id)} />
      </div>
    </li>
  );
}

function MainSection() {
  const { todos, state, toggleAll } = Todos.use();
  const filtered = () => {
    const f = state.filter;
    if (f === "active") return todos.filter(x => !x.completed);
    if (f === "completed") return todos.filter(x => x.completed);
    return todos;
  };
  const allCompleted = () => todos.length > 0 && todos.every(x => x.completed);
  return (
    <Show when={todos.length > 0}>
      <section class="main">
        <input
          id="toggle-all"
          class="toggle-all"
          type="checkbox"
          checked={allCompleted()}
          onChange={() => toggleAll(!allCompleted())}
        />
        <label for="toggle-all">Mark all as complete</label>
        <ul class="todo-list">
          <For each={filtered()}>{todo => <TodoItem todo={todo} />}</For>
        </ul>
      </section>
    </Show>
  );
}

function Footer() {
  const { todos, state, clearCompleted } = Todos.use();
  const remaining = () => todos.filter(x => !x.completed).length;
  const completed = () => todos.length - remaining();
  return (
    <Show when={todos.length > 0}>
      <footer class="footer">
        <span class="todo-count">
          <strong>{remaining()}</strong> {remaining() === 1 ? "item" : "items"} left
        </span>
        <ul class="filters">
          <li>
            <a href="#/" class={{ selected: state.filter === "all" }}>
              All
            </a>
          </li>
          <li>
            <a href="#/active" class={{ selected: state.filter === "active" }}>
              Active
            </a>
          </li>
          <li>
            <a href="#/completed" class={{ selected: state.filter === "completed" }}>
              Completed
            </a>
          </li>
        </ul>
        <Show when={completed() > 0}>
          <button class="clear-completed" onClick={() => clearCompleted()}>
            Clear completed
          </button>
        </Show>
      </footer>
    </Show>
  );
}

export function App(props: { todos: TodosApp }) {
  // The hash is input: it sets the filter. The filter writes the hash back, so
  // the URL follows time travel too.
  onSettled(() => {
    const onChange = () => props.todos.filterChanged(parseHash(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  });
  createEffect(
    () => props.todos.state.filter,
    filter => {
      if (parseHash(location.hash) !== filter) history.replaceState(null, "", filter === "all" ? "#/" : `#/${filter}`);
    }
  );
  return (
    <Todos.Context value={props.todos}>
      <Errored
        fallback={(err, reset) => (
          <div class="app-error">
            <p>Something went wrong: {String(err())}</p>
            <button
              onClick={() => {
                props.todos.reload();
                reset();
              }}
            >
              Reset
            </button>
          </div>
        )}
      >
        <section class="todoapp">
          <Header />
          <Loading fallback={<p class="loading">Loading…</p>}>
            <MainSection />
            <Footer />
          </Loading>
        </section>
      </Errored>
    </Todos.Context>
  );
}
