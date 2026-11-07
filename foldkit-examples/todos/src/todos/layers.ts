// The layering from solid/examples/todos/src/todos.ts, as a pure derivation.
// The view reads `displayedTodos(model)`: the error layer is applied over the
// persisted snapshot, then the optimistic overlay over that. Solid enforces
// the order by how its primitives compose; here it is the order of two calls.

import { Array, Option, pipe } from 'effect'
import { AsyncData } from 'foldkit'

import { type Todo, insertById } from '../api'
import { Change, type Model, type PendingWrite, TodoError } from './definition'

export type DisplayedTodo = Readonly<{
  id: string
  title: string
  completed: boolean
  pending: boolean
  maybeError: Option.Option<TodoError>
}>

export const errorTodoId = (error: TodoError): string =>
  TodoError.match(error, {
    AddTodo: ({ todo }) => todo.id,
    RemoveTodo: ({ id }) => id,
    ToggleTodo: ({ id }) => id,
  })

const hasId =
  (id: string) =>
  (todo: Readonly<{ id: string }>): boolean =>
    todo.id === id

const isOneOf =
  (ids: ReadonlyArray<string>) =>
  (todo: Readonly<{ id: string }>): boolean =>
    Array.some(ids, id => id === todo.id)

const settled = (todo: Todo): DisplayedTodo => ({
  ...todo,
  pending: false,
  maybeError: Option.none(),
})

// LAYER 2: ERRORS

const withError =
  (id: string, error: TodoError) =>
  (todos: ReadonlyArray<DisplayedTodo>): ReadonlyArray<DisplayedTodo> =>
    Array.map(todos, todo =>
      todo.id === id ? { ...todo, maybeError: Option.some(error) } : todo,
    )

const applyError = (
  todos: ReadonlyArray<DisplayedTodo>,
  error: TodoError,
): ReadonlyArray<DisplayedTodo> =>
  TodoError.match(error, {
    // The API never stored this todo. Reinsert it in id order, flagged, so
    // a failed add stays visible with its retry button.
    AddTodo: ({ todo }) =>
      Array.some(todos, hasId(todo.id))
        ? withError(todo.id, error)(todos)
        : insertById(todos, {
            ...settled(todo),
            maybeError: Option.some(error),
          }),
    RemoveTodo: ({ id }) => withError(id, error)(todos),
    ToggleTodo: ({ id }) => withError(id, error)(todos),
  })

// LAYER 3: OPTIMISTIC OVERLAY

const applyChange = (
  todos: ReadonlyArray<DisplayedTodo>,
  change: Change,
): ReadonlyArray<DisplayedTodo> =>
  Change.match(change, {
    AddTodo: ({ todo }) =>
      Array.some(todos, hasId(todo.id))
        ? Array.map(todos, existing =>
            existing.id === todo.id ? { ...existing, pending: true } : existing,
          )
        : Array.append(todos, { ...settled(todo), pending: true }),
    RemoveTodo: ({ id }) => Array.filter(todos, todo => todo.id !== id),
    ToggleTodo: ({ id, completed }) =>
      Array.map(todos, todo =>
        todo.id === id ? { ...todo, completed, pending: true } : todo,
      ),
    ToggleAll: ({ ids, completed }) =>
      Array.map(todos, todo =>
        isOneOf(ids)(todo) ? { ...todo, completed, pending: true } : todo,
      ),
    ClearCompleted: ({ ids }) =>
      Array.filter(todos, todo => !isOneOf(ids)(todo)),
  })

export const displayedTodos = (model: Model): ReadonlyArray<DisplayedTodo> =>
  pipe(
    AsyncData.getData(model.persisted),
    Option.getOrElse(() => Array.empty<Todo>()),
    Array.map(settled),
    todos => Array.reduce(model.errors, todos, applyError),
    todos =>
      Array.reduce(model.writes, todos, (current, { change }) =>
        applyChange(current, change),
      ),
  )

// SETTLING A WRITE

const affectedIds = (change: Change): ReadonlyArray<string> =>
  Change.match(change, {
    AddTodo: ({ todo }) => [todo.id],
    RemoveTodo: ({ id }) => [id],
    ToggleTodo: ({ id }) => [id],
    ToggleAll: ({ ids }) => ids,
    ClearCompleted: ({ ids }) => ids,
  })

/** What a failed write leaves behind. A bulk write fans out to one error per
 *  item, each with its own single-item retry. */
const failureErrors = (change: Change): ReadonlyArray<TodoError> =>
  Change.match(change, {
    AddTodo: ({ todo }) => [TodoError.AddTodo({ todo })],
    RemoveTodo: ({ id }) => [TodoError.RemoveTodo({ id })],
    ToggleTodo: ({ id, completed }) => [
      TodoError.ToggleTodo({ id, completed }),
    ],
    ToggleAll: ({ ids, completed }) =>
      Array.map(ids, id => TodoError.ToggleTodo({ id, completed })),
    ClearCompleted: ({ ids }) =>
      Array.map(ids, id => TodoError.RemoveTodo({ id })),
  })

/** `Errors[id] ||= error` on failure, `delete Errors[id]` on success. */
export const commitOutcome = (
  errors: ReadonlyArray<TodoError>,
  write: PendingWrite,
): ReadonlyArray<TodoError> =>
  Option.match(write.maybeOutcome, {
    onNone: () => errors,
    onSome: outcome => {
      if (outcome === 'Saved') {
        const ids = affectedIds(write.change)
        return Array.filter(
          errors,
          error => !Array.some(ids, id => id === errorTodoId(error)),
        )
      }
      return Array.reduce(
        failureErrors(write.change),
        errors,
        (current, error) =>
          Array.some(
            current,
            existing => errorTodoId(existing) === errorTodoId(error),
          )
            ? current
            : Array.append(current, error),
      )
    },
  })

/** Retrying replays the failed call with its original arguments. */
export const retryChange = (error: TodoError): Change =>
  TodoError.match(error, {
    AddTodo: ({ todo }) => Change.AddTodo({ todo }),
    RemoveTodo: ({ id }) => Change.RemoveTodo({ id }),
    ToggleTodo: ({ id, completed }) => Change.ToggleTodo({ id, completed }),
  })

export const findError = (
  errors: ReadonlyArray<TodoError>,
  id: string,
): Option.Option<TodoError> =>
  Array.findFirst(errors, error => errorTodoId(error) === id)
