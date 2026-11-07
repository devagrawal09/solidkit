import { Clock, Effect, Layer, Random, Schema } from 'effect'

import { Todo, TodoApi } from '../api'
import { Message, TodosDefinition } from './definition'

// Every handler asks the Layer for `TodoApi` once, when the Runtime builds the
// application, and returns the per-invocation function. The Block never sees
// the implementation; `services.ts` provides it.

export const LoadTodos = TodosDefinition.makeCommand('LoadTodos', {
  messages: [Message.SucceededLoadTodos, Message.FailedLoadTodos],
  handler: function* () {
    const api = yield* TodoApi

    return () =>
      api.getTodos.pipe(
        Effect.map(todos => Message.SucceededLoadTodos({ todos })),
        Effect.catch(({ reason }) =>
          Effect.succeed(Message.FailedLoadTodos({ reason })),
        ),
      )
  },
})

/** The original builds ids in the event handler from `Date.now()` and
 *  `Math.random()`. Both are effects, so they run here. */
export const GenerateTodo = TodosDefinition.makeCommand('GenerateTodo', {
  args: { title: Schema.String },
  messages: [Message.GeneratedTodo],
  handler: function* () {
    const clock = yield* Clock.Clock

    return ({ title }) =>
      Effect.gen(function* () {
        const now = yield* clock.currentTimeMillis
        const random = yield* Random.next
        const suffix = random.toString(36).slice(2, 7)
        const todo: Todo = { id: `${now}-${suffix}`, title, completed: false }
        return Message.GeneratedTodo({ todo })
      })
  },
})

const settleSave =
  (writeId: number) =>
  <A, E>(save: Effect.Effect<A, E>) =>
    save.pipe(
      Effect.as(Message.SucceededSaveTodos({ writeId })),
      Effect.catch(() => Effect.succeed(Message.FailedSaveTodos({ writeId }))),
    )

const saveMessages = [
  Message.SucceededSaveTodos,
  Message.FailedSaveTodos,
] as const

export const AddTodo = TodosDefinition.makeCommand('AddTodo', {
  args: { writeId: Schema.Number, todo: Todo },
  messages: saveMessages,
  handler: function* () {
    const api = yield* TodoApi
    return ({ writeId, todo }) => settleSave(writeId)(api.addTodo(todo))
  },
})

export const RemoveTodo = TodosDefinition.makeCommand('RemoveTodo', {
  args: { writeId: Schema.Number, id: Schema.String },
  messages: saveMessages,
  handler: function* () {
    const api = yield* TodoApi
    return ({ writeId, id }) => settleSave(writeId)(api.removeTodo(id))
  },
})

export const ToggleTodo = TodosDefinition.makeCommand('ToggleTodo', {
  args: {
    writeId: Schema.Number,
    id: Schema.String,
    completed: Schema.Boolean,
  },
  messages: saveMessages,
  handler: function* () {
    const api = yield* TodoApi
    return ({ writeId, id, completed }) =>
      settleSave(writeId)(api.toggleTodo(id, completed))
  },
})

export const ToggleAllTodos = TodosDefinition.makeCommand('ToggleAllTodos', {
  args: {
    writeId: Schema.Number,
    ids: Schema.Array(Schema.String),
    completed: Schema.Boolean,
  },
  messages: saveMessages,
  handler: function* () {
    const api = yield* TodoApi
    return ({ writeId, ids, completed }) =>
      settleSave(writeId)(api.toggleAll(ids, completed))
  },
})

export const ClearCompletedTodos = TodosDefinition.makeCommand(
  'ClearCompletedTodos',
  {
    args: { writeId: Schema.Number, ids: Schema.Array(Schema.String) },
    messages: saveMessages,
    handler: function* () {
      const api = yield* TodoApi
      return ({ writeId, ids }) => settleSave(writeId)(api.clearCompleted(ids))
    },
  },
)

/** The original's `refresh(todos)`: re-read the list after every write. */
export const RefreshTodos = TodosDefinition.makeCommand('RefreshTodos', {
  args: { writeId: Schema.Number, refresh: Schema.Number },
  messages: [Message.SucceededRefreshTodos, Message.FailedRefreshTodos],
  handler: function* () {
    const api = yield* TodoApi

    return ({ writeId, refresh }) =>
      api.getTodos.pipe(
        Effect.map(todos =>
          Message.SucceededRefreshTodos({ writeId, refresh, todos }),
        ),
        Effect.catch(({ reason }) =>
          Effect.succeed(Message.FailedRefreshTodos({ writeId, reason })),
        ),
      )
  },
})

export const EffectsLayer = Layer.mergeAll(
  LoadTodos.layer,
  GenerateTodo.layer,
  AddTodo.layer,
  RemoveTodo.layer,
  ToggleTodo.layer,
  ToggleAllTodos.layer,
  ClearCompletedTodos.layer,
  RefreshTodos.layer,
)
