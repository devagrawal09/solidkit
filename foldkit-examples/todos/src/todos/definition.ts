import { Schema } from 'effect'
import { AsyncData, Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'

import { Todo, Todos } from '../api'

// MODEL
//
// The Solid original keeps three lifetime layers inside one optimistic store.
// Here they are three Model fields, and `layers.ts` derives what the view
// shows from them, in the same fixed order:
//
//   1. persisted  the last snapshot read from the API (AsyncData, so the
//                 initial load and load failures are explicit states)
//   2. errors     per-item failures, kept until a later write for that item
//                 succeeds; applied on top of (1)
//   3. writes     one entry per in-flight write: the optimistic overlay,
//                 applied on top of (2) and dropped when that write's
//                 refetch lands

/** A failed write, recorded per todo so each item gets its own retry. */
export const TodoError = defineTaggedUnion({
  AddTodo: { todo: Todo },
  RemoveTodo: { id: Schema.String },
  ToggleTodo: { id: Schema.String, completed: Schema.Boolean },
})
export type TodoError = typeof TodoError.Type

/** One write, mirroring the five mutating calls of the API. */
export const Change = defineTaggedUnion({
  AddTodo: { todo: Todo },
  RemoveTodo: { id: Schema.String },
  ToggleTodo: { id: Schema.String, completed: Schema.Boolean },
  ToggleAll: { ids: Schema.Array(Schema.String), completed: Schema.Boolean },
  ClearCompleted: { ids: Schema.Array(Schema.String) },
})
export type Change = typeof Change.Type

export const SaveOutcome = Schema.Literals(['Saved', 'Failed'])
export type SaveOutcome = typeof SaveOutcome.Type

/** An in-flight write. `maybeOutcome` is set once the save settles; the
 *  outcome is committed together with the refetched snapshot, as the
 *  original commits both in one transition. */
export const PendingWrite = Schema.Struct({
  writeId: Schema.Number,
  change: Change,
  maybeOutcome: Schema.Option(SaveOutcome),
})
export type PendingWrite = typeof PendingWrite.Type

export const PersistedTodos = AsyncData.Schema(Todos, Schema.String)

export const Model = Schema.Struct({
  persisted: PersistedTodos.schema,
  errors: Schema.Array(TodoError),
  writes: Schema.Array(PendingWrite),
  nextWriteId: Schema.Number,
  refreshesIssued: Schema.Number,
  refreshApplied: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ToggledTodo: { id: Schema.String, completed: Schema.Boolean },
  ClickedDestroyTodo: { id: Schema.String },
  ClickedRetryTodo: { id: Schema.String },
  ToggledAllTodos: { completed: Schema.Boolean },
  ClickedClearCompleted: {},
  ClickedReset: {},
  RequestedAddTodo: { title: Schema.String },
  GeneratedTodo: { todo: Todo },
  SucceededLoadTodos: { todos: Todos },
  FailedLoadTodos: { reason: Schema.String },
  SucceededSaveTodos: { writeId: Schema.Number },
  FailedSaveTodos: { writeId: Schema.Number },
  SucceededRefreshTodos: {
    writeId: Schema.Number,
    refresh: Schema.Number,
    todos: Todos,
  },
  FailedRefreshTodos: { writeId: Schema.Number, reason: Schema.String },
})

export const TodosDefinition = Block.makeDefinition('Todos', {
  Model,
  Message,
})

export const { makeFieldsStep } = TodosDefinition
