// The todos app: NewTodo reports a title; the root asks TodoList to add it.
import { Errored, Loading } from "solid-js";
import { block, field } from "@solidkit/blocks";
import type { Api } from "./api.ts";
import { NewTodo, type Model as NewTodoModel } from "./new-todo.tsx";
import { TodoList, type Model as TodoListModel } from "./todo-list.tsx";

export type Model = { header: NewTodoModel; list: TodoListModel };
export type Args = { hash: string };

export const App = block<{ model: Model; msg: never; services: { api: Api }; args: Args }>()({
  name: "todos",
  requires: { api: true },
  children: {
    header: field(NewTodo),
    list: field(TodoList, { init: (args: Args) => args })
  },
  init: () => ({}),
  update: () => {},
  out: {
    header: {
      EnteredTitle: (out, _model, ctx) => ctx.blocks.list.add({ id: out.id, title: out.title })
    }
  },
  view: props => (
    <Errored
      fallback={(err, reset) => (
        <div class="app-error">
          <p>Something went wrong: {String(err())}</p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <section class="todoapp">
        <props.blocks.header />
        <Loading fallback={<p class="loading">Loading…</p>}>
          <props.blocks.list />
        </Loading>
      </section>
    </Errored>
  )
});
