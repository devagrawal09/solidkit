// Markup and TodoMVC classes follow solid/examples/todos/src/app.tsx:
// MainSection, TodoItem and Footer, plus the Errored and Loading fallbacks.

import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html } from 'foldkit/html'

import { type Filter, filterHref } from '../filter'
import { TodosComposition, type TodosViewBuilder } from './composition'
import { Message, TodoError } from './definition'
import { type DisplayedTodo, displayedTodos } from './layers'

export type ViewInputs = Readonly<{
  filter: Filter
  /** The header is a sibling Block owned by the parent. The parent passes a
   *  render callback (functions are the one thing `viewInputs` may carry
   *  besides plain data) so this view keeps the original `section.todoapp`
   *  structure. Foldkit replays the parent's frame when it is called. */
  renderHeader: () => Html
}>

/** The original's retry title reads `Retry ${error.type}`. */
const errorType = (error: TodoError): string =>
  TodoError.match(error, {
    AddTodo: () => 'addTodo',
    RemoveTodo: () => 'removeTodo',
    ToggleTodo: () => 'toggleTodo',
  })

const todoClass = (todo: DisplayedTodo): string =>
  Array.join(
    Array.getSomes([
      Option.some('todo'),
      todo.completed ? Option.some('completed') : Option.none(),
      todo.pending ? Option.some('pending') : Option.none(),
      Option.isSome(todo.maybeError) ? Option.some('errored') : Option.none(),
    ]),
    ' ',
  )

const todoItemView = (todo: DisplayedTodo, h: TodosViewBuilder): Html =>
  h.keyed('li')(
    todo.id,
    [h.Class(todoClass(todo))],
    [
      h.div(
        [h.Class('view')],
        [
          h.input([
            h.Class('toggle'),
            h.Type('checkbox'),
            h.Checked(todo.completed),
            h.OnChange(() =>
              Message.ToggledTodo({ id: todo.id, completed: !todo.completed }),
            ),
          ]),
          h.label([], [todo.title]),
          Option.match(todo.maybeError, {
            onNone: () => h.empty,
            onSome: error =>
              h.button([
                h.Class('retry'),
                h.Title(`Retry ${errorType(error)}`),
                h.OnClick(Message.ClickedRetryTodo({ id: todo.id })),
              ]),
          }),
          h.button([
            h.Class('destroy'),
            h.OnClick(Message.ClickedDestroyTodo({ id: todo.id })),
          ]),
        ],
      ),
    ],
  )

const filterTodos = (
  todos: ReadonlyArray<DisplayedTodo>,
  filter: Filter,
): ReadonlyArray<DisplayedTodo> => {
  if (filter === 'Active') {
    return Array.filter(todos, todo => !todo.completed)
  }
  if (filter === 'Completed') {
    return Array.filter(todos, todo => todo.completed)
  }
  return todos
}

const mainView = (
  todos: ReadonlyArray<DisplayedTodo>,
  filter: Filter,
  h: TodosViewBuilder,
): Html => {
  const allCompleted = Array.every(todos, todo => todo.completed)
  return h.section(
    [h.Class('main')],
    [
      h.input([
        h.Id('toggle-all'),
        h.Class('toggle-all'),
        h.Type('checkbox'),
        h.Checked(allCompleted),
        h.OnChange(() => Message.ToggledAllTodos({ completed: !allCompleted })),
      ]),
      h.label([h.For('toggle-all')], ['Mark all as complete']),
      h.ul(
        [h.Class('todo-list')],
        Array.map(filterTodos(todos, filter), todo => todoItemView(todo, h)),
      ),
    ],
  )
}

const filterLinkView = (
  filter: Filter,
  label: string,
  selected: Filter,
  h: TodosViewBuilder,
): Html =>
  h.li(
    [],
    [
      h.a(
        [
          h.Href(filterHref(filter)),
          h.Class(filter === selected ? 'selected' : ''),
        ],
        [label],
      ),
    ],
  )

const footerView = (
  todos: ReadonlyArray<DisplayedTodo>,
  filter: Filter,
  h: TodosViewBuilder,
): Html => {
  const remaining = Array.length(Array.filter(todos, todo => !todo.completed))
  const completed = Array.length(todos) - remaining
  return h.footer(
    [h.Class('footer')],
    [
      h.span(
        [h.Class('todo-count')],
        [
          h.strong([], [String(remaining)]),
          ` ${remaining === 1 ? 'item' : 'items'} left`,
        ],
      ),
      h.ul(
        [h.Class('filters')],
        [
          filterLinkView('All', 'All', filter, h),
          filterLinkView('Active', 'Active', filter, h),
          filterLinkView('Completed', 'Completed', filter, h),
        ],
      ),
      completed > 0
        ? h.button(
            [
              h.Class('clear-completed'),
              h.OnClick(Message.ClickedClearCompleted()),
            ],
            ['Clear completed'],
          )
        : h.empty,
    ],
  )
}

/** The original's top-level `<Errored>` fallback. A failed load lands here as
 *  a Message; anything unexpected reaches the Program's crash view instead. */
const appErrorView = (reason: string, h: TodosViewBuilder): Html =>
  h.div(
    [h.Class('app-error')],
    [
      h.p([], [`Something went wrong: ${reason}`]),
      h.button([h.OnClick(Message.ClickedReset())], ['Reset']),
    ],
  )

export const view = TodosComposition.makeView.withInputs<ViewInputs>(
  (model, { filter, renderHeader }, h) =>
    AsyncData.matchData(model.persisted, {
      onEmpty: () =>
        h.section(
          [h.Class('todoapp')],
          [renderHeader(), h.p([h.Class('loading')], ['Loading…'])],
        ),
      onFailure: reason => appErrorView(reason, h),
      onData: () => {
        const todos = displayedTodos(model)
        return h.section(
          [h.Class('todoapp')],
          Array.length(todos) === 0
            ? [renderHeader()]
            : [
                renderHeader(),
                mainView(todos, filter, h),
                footerView(todos, filter, h),
              ],
        )
      },
    }),
)
