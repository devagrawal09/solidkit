import { Array, Number, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  AddTodo,
  ClearCompletedTodos,
  GenerateTodo,
  LoadTodos,
  RefreshTodos,
  RemoveTodo,
  ToggleAllTodos,
  ToggleTodo,
} from './command'
import { TodosComposition } from './composition'
import {
  Change,
  type Model,
  PendingWrite,
  PersistedTodos,
  type SaveOutcome,
  makeFieldsStep,
} from './definition'
import { commitOutcome, displayedTodos, findError, retryChange } from './layers'

export const init = TodosComposition.makeInit(() => ({
  model: {
    persisted: PersistedTodos.Loading(),
    errors: [],
    writes: [],
    nextWriteId: 0,
    refreshesIssued: 0,
    refreshApplied: 0,
  },
  commands: [LoadTodos()],
}))

const writeCommand = (writeId: number, change: Change) =>
  Change.match(change, {
    AddTodo: ({ todo }) => AddTodo({ writeId, todo }),
    RemoveTodo: ({ id }) => RemoveTodo({ writeId, id }),
    ToggleTodo: ({ id, completed }) => ToggleTodo({ writeId, id, completed }),
    ToggleAll: ({ ids, completed }) =>
      ToggleAllTodos({ writeId, ids, completed }),
    ClearCompleted: ({ ids }) => ClearCompletedTodos({ writeId, ids }),
  })

/** Every mutation starts the same way: add the change to the optimistic
 *  overlay and send the matching API call. */
const startWrite = (model: Model, change: Change) => {
  const writeId = model.nextWriteId
  return {
    model: modifyFields(model, {
      nextWriteId: Number.increment,
      writes: Array.append(
        PendingWrite.make({ writeId, change, maybeOutcome: Option.none() }),
      ),
    }),
    commands: [writeCommand(writeId, change)],
  }
}

/** A settled save records its outcome on the write and re-reads the list.
 *  The outcome is committed when that refetch lands. */
const settleSave = (model: Model, writeId: number, outcome: SaveOutcome) => {
  const refresh = model.refreshesIssued + 1
  return {
    model: modifyFields(model, {
      refreshesIssued: () => refresh,
      writes: Array.map(write =>
        write.writeId === writeId
          ? PendingWrite.make({ ...write, maybeOutcome: Option.some(outcome) })
          : write,
      ),
    }),
    commands: [RefreshTodos({ writeId, refresh })],
  }
}

/** The end of the original's action transition: commit the write's outcome
 *  into the error layer and drop its optimistic entry, together. */
const finishWrite = (model: Model, writeId: number) =>
  Option.match(
    Array.findFirst(model.writes, write => write.writeId === writeId),
    {
      onNone: () => model,
      onSome: write =>
        modifyFields(model, {
          errors: errors => commitOutcome(errors, write),
          writes: Array.filter(pending => pending.writeId !== writeId),
        }),
    },
  )

export const update = TodosComposition.makeUpdate({
  RequestedAddTodo: (model, { title }) => ({
    model,
    commands: [GenerateTodo({ title })],
  }),

  GeneratedTodo: (model, { todo }) =>
    startWrite(model, Change.AddTodo({ todo })),

  ToggledTodo: (model, { id, completed }) =>
    startWrite(model, Change.ToggleTodo({ id, completed })),

  ClickedDestroyTodo: (model, { id }) =>
    startWrite(model, Change.RemoveTodo({ id })),

  ClickedRetryTodo: (model, { id }) =>
    Option.match(findError(model.errors, id), {
      onNone: () => ({ model }),
      onSome: error => startWrite(model, retryChange(error)),
    }),

  ToggledAllTodos: (model, { completed }) => {
    const ids = Array.map(
      Array.filter(displayedTodos(model), todo => todo.completed !== completed),
      todo => todo.id,
    )
    return startWrite(model, Change.ToggleAll({ ids, completed }))
  },

  ClickedClearCompleted: model => {
    const ids = Array.map(
      Array.filter(displayedTodos(model), todo => todo.completed),
      todo => todo.id,
    )
    return startWrite(model, Change.ClearCompleted({ ids }))
  },

  ClickedReset: model => ({
    model: modifyFields(model, { persisted: () => PersistedTodos.Loading() }),
    commands: [LoadTodos()],
  }),

  SucceededLoadTodos: makeFieldsStep.fromMessage(({ todos }) => ({
    persisted: () => PersistedTodos.Success({ data: todos }),
  })),

  FailedLoadTodos: makeFieldsStep.fromMessage(({ reason }) => ({
    persisted: () => PersistedTodos.Failure({ error: reason }),
  })),

  SucceededSaveTodos: (model, { writeId }) =>
    settleSave(model, writeId, 'Saved'),

  FailedSaveTodos: (model, { writeId }) => settleSave(model, writeId, 'Failed'),

  SucceededRefreshTodos: (model, { writeId, refresh, todos }) => {
    const isNewest = refresh > model.refreshApplied
    return {
      model: modifyFields(finishWrite(model, writeId), {
        persisted: current =>
          isNewest ? PersistedTodos.Success({ data: todos }) : current,
        refreshApplied: current => (isNewest ? refresh : current),
      }),
    }
  },

  // A failed re-read behaves like a failed load: the error replaces the app.
  FailedRefreshTodos: (model, { writeId, reason }) => ({
    model: modifyFields(finishWrite(model, writeId), {
      persisted: () => PersistedTodos.Failure({ error: reason }),
    }),
  }),
})
