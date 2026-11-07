// Port of solid/examples/todos/src/api.ts: the mock TodoMVC backend.
//
// The original is a plain object of async functions over localStorage. Here
// it is an Effect Service: the interface is the `TodoApi` tag, and the
// implementation is a Layer that needs a `KeyValueStore` (localStorage in the
// browser, an in-memory store in tests). Behavior is unchanged: every call
// takes 400 ms, and ~33% of saves fail without writing anything.

import {
  Array,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Random,
  Schema,
} from 'effect'
import { KeyValueStore } from 'effect/persistence'

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
})
export type Todo = typeof Todo.Type

export const Todos = Schema.Array(Todo)

const TodosJson = Schema.fromJsonString(Schema.toCodecJson(Todos))

const STORAGE_KEY = 'TODOS'
const LATENCY = Duration.millis(400)
const SAVE_FAILURE_RATE = 0.33

/** A rejected save. The original rejects with the string "Failed to Save". */
export class SaveFailed extends Data.TaggedError('SaveFailed')<{
  readonly reason: string
}> {}

/** The stored list could not be read or decoded. */
export class LoadFailed extends Data.TaggedError('LoadFailed')<{
  readonly reason: string
}> {}

export class TodoApi extends Context.Service<
  TodoApi,
  Readonly<{
    getTodos: Effect.Effect<ReadonlyArray<Todo>, LoadFailed>
    addTodo: (todo: Todo) => Effect.Effect<Todo, SaveFailed>
    removeTodo: (id: string) => Effect.Effect<void, SaveFailed>
    toggleTodo: (
      id: string,
      completed: boolean,
    ) => Effect.Effect<Todo, SaveFailed>
    toggleAll: (
      ids: ReadonlyArray<string>,
      completed: boolean,
    ) => Effect.Effect<void, SaveFailed>
    clearCompleted: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<void, SaveFailed>
  }>
>()('TodoApi') {}

/** Insert in id order, as the original does (ids start with a timestamp). */
export const insertById = <A extends Readonly<{ id: string }>>(
  todos: ReadonlyArray<A>,
  todo: A,
): ReadonlyArray<A> =>
  Option.match(
    Array.findFirstIndex(todos, existing => existing.id > todo.id),
    {
      onNone: () => Array.append(todos, todo),
      onSome: index =>
        Option.getOrElse(Array.insertAt(todos, index, todo), () =>
          Array.append(todos, todo),
        ),
    },
  )

const failSave = Effect.sleep(LATENCY).pipe(
  Effect.andThen(Effect.fail(new SaveFailed({ reason: 'Failed to Save' }))),
)

export const TodoApiLayer = Layer.effect(
  TodoApi,
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore

    const readTodos = Effect.gen(function* () {
      const json = yield* store.get(STORAGE_KEY)
      if (json === undefined) {
        return Array.empty<Todo>()
      }
      return yield* Schema.decodeEffect(TodosJson)(json)
    }).pipe(Effect.mapError(error => new LoadFailed({ reason: error.message })))

    const readForWrite = readTodos.pipe(
      Effect.mapError(({ reason }) => new SaveFailed({ reason })),
    )

    // saveTodos: fail ~33% of the time after the delay without writing;
    // otherwise write immediately and resolve after the delay.
    const saveTodos = (todos: ReadonlyArray<Todo>) =>
      Effect.gen(function* () {
        const roll = yield* Random.next
        if (roll < SAVE_FAILURE_RATE) {
          return yield* failSave
        }
        const json = yield* Schema.encodeEffect(TodosJson)(todos).pipe(
          Effect.mapError(error => new SaveFailed({ reason: error.message })),
        )
        yield* store
          .set(STORAGE_KEY, json)
          .pipe(
            Effect.mapError(error => new SaveFailed({ reason: error.message })),
          )
        yield* Effect.sleep(LATENCY)
      })

    return {
      getTodos: readTodos.pipe(Effect.tap(() => Effect.sleep(LATENCY))),

      addTodo: todo =>
        readForWrite.pipe(
          Effect.flatMap(todos => saveTodos(insertById(todos, todo))),
          Effect.as(todo),
        ),

      removeTodo: id =>
        readForWrite.pipe(
          Effect.flatMap(todos =>
            saveTodos(Array.filter(todos, todo => todo.id !== id)),
          ),
        ),

      toggleTodo: (id, completed) =>
        Effect.gen(function* () {
          const todos = yield* readForWrite
          const maybeFound = Array.findFirst(todos, todo => todo.id === id)
          if (Option.isNone(maybeFound)) {
            return yield* failSave
          }
          const toggled = { ...maybeFound.value, completed }
          yield* saveTodos(
            Array.map(todos, todo => (todo.id === id ? toggled : todo)),
          )
          return toggled
        }),

      toggleAll: (ids, completed) =>
        readForWrite.pipe(
          Effect.flatMap(todos =>
            saveTodos(
              Array.map(todos, todo =>
                Array.some(ids, id => id === todo.id)
                  ? { ...todo, completed }
                  : todo,
              ),
            ),
          ),
        ),

      clearCompleted: ids =>
        readForWrite.pipe(
          Effect.flatMap(todos =>
            saveTodos(
              Array.filter(
                todos,
                todo => !Array.some(ids, id => id === todo.id),
              ),
            ),
          ),
        ),
    }
  }),
)
