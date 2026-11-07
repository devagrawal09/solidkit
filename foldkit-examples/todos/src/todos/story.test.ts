import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import type { Todo } from '../api'
import {
  AddTodo,
  ClearCompletedTodos,
  GenerateTodo,
  RefreshTodos,
  RemoveTodo,
  ToggleAllTodos,
  ToggleTodo,
} from './command'
import { Message, type Model, PersistedTodos, TodoError } from './definition'
import { displayedTodos } from './layers'
import { init, update } from './update'

const writePort: Todo = { id: '1-a', title: 'Port the API', completed: false }
const readDocs: Todo = { id: '2-b', title: 'Read the docs', completed: false }
const shipIt: Todo = { id: '3-c', title: 'Ship it', completed: true }

const loaded = (todos: ReadonlyArray<Todo>): Model => ({
  ...init().model,
  persisted: PersistedTodos.Success({ data: todos }),
})

const shown = (current: Model) =>
  Array.map(displayedTodos(current), todo => ({
    id: todo.id,
    completed: todo.completed,
    pending: todo.pending,
    error: Option.getOrUndefined(todo.maybeError),
  }))

describe('initial load', () => {
  test('starts Loading and shows the stored list once it arrives', () => {
    story(
      update,
      given(init().model),
      model(current => {
        expect(current.persisted).toEqual(PersistedTodos.Loading())
      }),
      message(Message.SucceededLoadTodos({ todos: [writePort, shipIt] })),
      model(current => {
        expect(Array.map(displayedTodos(current), todo => todo.id)).toEqual([
          writePort.id,
          shipIt.id,
        ])
      }),
    )
  })

  test('a failed load replaces the list with the error state', () => {
    story(
      update,
      given(init().model),
      message(Message.FailedLoadTodos({ reason: 'bad JSON' })),
      model(current => {
        expect(current.persisted).toEqual(
          PersistedTodos.Failure({ error: 'bad JSON' }),
        )
      }),
    )
  })
})

describe('optimistic writes', () => {
  test('a failed toggle reverts, keeps a retry, and the retry replays the toggle', () => {
    const toggle = ToggleTodo({ writeId: 0, id: writePort.id, completed: true })
    const retry = ToggleTodo({ writeId: 1, id: writePort.id, completed: true })

    story(
      update,
      given(loaded([writePort])),
      message(Message.ToggledTodo({ id: writePort.id, completed: true })),
      Command.expectExact(toggle),
      model(current => {
        expect(shown(current)).toEqual([
          {
            id: writePort.id,
            completed: true,
            pending: true,
            error: undefined,
          },
        ])
      }),
      Command.resolve(toggle, Message.FailedSaveTodos({ writeId: 0 })),
      // As in the original, nothing changes on screen until the re-read lands.
      model(current => {
        expect(shown(current)[0]?.pending).toBe(true)
        expect(current.errors).toEqual([])
      }),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [writePort],
        }),
      ),
      model(current => {
        expect(shown(current)).toEqual([
          {
            id: writePort.id,
            completed: false,
            pending: false,
            error: TodoError.ToggleTodo({ id: writePort.id, completed: true }),
          },
        ])
      }),
      message(Message.ClickedRetryTodo({ id: writePort.id })),
      Command.expectExact(retry),
      model(current => {
        // Pending and still errored while the retry is in flight.
        expect(shown(current)[0]?.pending).toBe(true)
        expect(shown(current)[0]?.error).toBeDefined()
      }),
      Command.resolve(retry, Message.SucceededSaveTodos({ writeId: 1 })),
      Command.resolve(
        RefreshTodos({ writeId: 1, refresh: 2 }),
        Message.SucceededRefreshTodos({
          writeId: 1,
          refresh: 2,
          todos: [{ ...writePort, completed: true }],
        }),
      ),
      model(current => {
        expect(shown(current)).toEqual([
          {
            id: writePort.id,
            completed: true,
            pending: false,
            error: undefined,
          },
        ])
        expect(current.writes).toEqual([])
      }),
    )
  })

  test('a failed add stays visible with a retry for the same todo', () => {
    const fresh: Todo = { id: '9-z', title: 'Fresh', completed: false }
    const add = AddTodo({ writeId: 0, todo: fresh })

    story(
      update,
      given(loaded([writePort])),
      message(Message.RequestedAddTodo({ title: 'Fresh' })),
      Command.resolve(
        GenerateTodo({ title: 'Fresh' }),
        Message.GeneratedTodo({ todo: fresh }),
      ),
      Command.expectExact(add),
      model(current => {
        expect(shown(current)[1]).toEqual({
          id: fresh.id,
          completed: false,
          pending: true,
          error: undefined,
        })
      }),
      Command.resolve(add, Message.FailedSaveTodos({ writeId: 0 })),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [writePort],
        }),
      ),
      model(current => {
        expect(shown(current)).toEqual([
          {
            id: writePort.id,
            completed: false,
            pending: false,
            error: undefined,
          },
          {
            id: fresh.id,
            completed: false,
            pending: false,
            error: TodoError.AddTodo({ todo: fresh }),
          },
        ])
      }),
      message(Message.ClickedRetryTodo({ id: fresh.id })),
      Command.expectExact(AddTodo({ writeId: 1, todo: fresh })),
      Command.resolve(
        AddTodo({ writeId: 1, todo: fresh }),
        Message.SucceededSaveTodos({ writeId: 1 }),
      ),
      Command.resolve(
        RefreshTodos({ writeId: 1, refresh: 2 }),
        Message.SucceededRefreshTodos({
          writeId: 1,
          refresh: 2,
          todos: [writePort, fresh],
        }),
      ),
      model(current => {
        expect(current.errors).toEqual([])
        expect(Array.map(displayedTodos(current), todo => todo.id)).toEqual([
          writePort.id,
          fresh.id,
        ])
      }),
    )
  })

  test('a remove hides the item at once; a failed remove brings it back with a retry', () => {
    const remove = RemoveTodo({ writeId: 0, id: readDocs.id })

    story(
      update,
      given(loaded([writePort, readDocs])),
      message(Message.ClickedDestroyTodo({ id: readDocs.id })),
      model(current => {
        expect(Array.map(displayedTodos(current), todo => todo.id)).toEqual([
          writePort.id,
        ])
      }),
      Command.resolve(remove, Message.FailedSaveTodos({ writeId: 0 })),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [writePort, readDocs],
        }),
      ),
      model(current => {
        expect(shown(current)[1]?.error).toEqual(
          TodoError.RemoveTodo({ id: readDocs.id }),
        )
      }),
    )
  })
})

describe('bulk writes', () => {
  test('a failed toggle-all fans out to one retry per item', () => {
    const toggleAll = ToggleAllTodos({
      writeId: 0,
      ids: [writePort.id, readDocs.id],
      completed: true,
    })

    story(
      update,
      given(loaded([writePort, readDocs, shipIt])),
      message(Message.ToggledAllTodos({ completed: true })),
      // Only the items whose state changes are sent, in one call.
      Command.expectExact(toggleAll),
      model(current => {
        expect(
          Array.every(displayedTodos(current), todo => todo.completed),
        ).toBe(true)
      }),
      Command.resolve(toggleAll, Message.FailedSaveTodos({ writeId: 0 })),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [writePort, readDocs, shipIt],
        }),
      ),
      model(current => {
        expect(current.errors).toEqual([
          TodoError.ToggleTodo({ id: writePort.id, completed: true }),
          TodoError.ToggleTodo({ id: readDocs.id, completed: true }),
        ])
        expect(Array.map(shown(current), todo => todo.completed)).toEqual([
          false,
          false,
          true,
        ])
      }),
      // Each item retries on its own, as a single toggle.
      message(Message.ClickedRetryTodo({ id: readDocs.id })),
      Command.expectExact(
        ToggleTodo({ writeId: 1, id: readDocs.id, completed: true }),
      ),
      Command.resolve(
        ToggleTodo({ writeId: 1, id: readDocs.id, completed: true }),
        Message.SucceededSaveTodos({ writeId: 1 }),
      ),
      Command.resolve(
        RefreshTodos({ writeId: 1, refresh: 2 }),
        Message.SucceededRefreshTodos({
          writeId: 1,
          refresh: 2,
          todos: [writePort, { ...readDocs, completed: true }, shipIt],
        }),
      ),
      model(current => {
        expect(current.errors).toEqual([
          TodoError.ToggleTodo({ id: writePort.id, completed: true }),
        ])
      }),
    )
  })

  test('a failed clear-completed fans out to one remove retry per item', () => {
    const doneDocs: Todo = { ...readDocs, completed: true }
    const clear = ClearCompletedTodos({
      writeId: 0,
      ids: [doneDocs.id, shipIt.id],
    })

    story(
      update,
      given(loaded([writePort, doneDocs, shipIt])),
      message(Message.ClickedClearCompleted()),
      Command.expectExact(clear),
      model(current => {
        expect(Array.map(displayedTodos(current), todo => todo.id)).toEqual([
          writePort.id,
        ])
      }),
      Command.resolve(clear, Message.FailedSaveTodos({ writeId: 0 })),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [writePort, doneDocs, shipIt],
        }),
      ),
      model(current => {
        expect(current.errors).toEqual([
          TodoError.RemoveTodo({ id: doneDocs.id }),
          TodoError.RemoveTodo({ id: shipIt.id }),
        ])
        expect(displayedTodos(current)).toHaveLength(3)
      }),
      message(Message.ClickedRetryTodo({ id: shipIt.id })),
      Command.expectExact(RemoveTodo({ writeId: 1, id: shipIt.id })),
      Command.resolve(
        RemoveTodo({ writeId: 1, id: shipIt.id }),
        Message.SucceededSaveTodos({ writeId: 1 }),
      ),
      Command.resolve(
        RefreshTodos({ writeId: 1, refresh: 2 }),
        Message.SucceededRefreshTodos({
          writeId: 1,
          refresh: 2,
          todos: [writePort, doneDocs],
        }),
      ),
      model(current => {
        expect(current.errors).toEqual([
          TodoError.RemoveTodo({ id: doneDocs.id }),
        ])
      }),
    )
  })
})

describe('concurrent writes', () => {
  test('an older re-read cannot overwrite a newer snapshot', () => {
    const toggleA = ToggleTodo({
      writeId: 0,
      id: writePort.id,
      completed: true,
    })
    const toggleB = ToggleTodo({ writeId: 1, id: readDocs.id, completed: true })
    const both = [
      { ...writePort, completed: true },
      { ...readDocs, completed: true },
    ]

    story(
      update,
      given(loaded([writePort, readDocs])),
      message(Message.ToggledTodo({ id: writePort.id, completed: true })),
      message(Message.ToggledTodo({ id: readDocs.id, completed: true })),
      Command.resolve(toggleA, Message.SucceededSaveTodos({ writeId: 0 })),
      Command.resolve(toggleB, Message.SucceededSaveTodos({ writeId: 1 })),
      Command.resolve(
        RefreshTodos({ writeId: 1, refresh: 2 }),
        Message.SucceededRefreshTodos({ writeId: 1, refresh: 2, todos: both }),
      ),
      Command.resolve(
        RefreshTodos({ writeId: 0, refresh: 1 }),
        Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [{ ...writePort, completed: true }, readDocs],
        }),
      ),
      model(current => {
        expect(current.persisted).toEqual(
          PersistedTodos.Success({ data: both }),
        )
        expect(current.writes).toEqual([])
      }),
    )
  })
})
