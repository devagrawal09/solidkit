import { Option } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  change,
  click,
  expect,
  given,
  keydown,
  label,
  placeholder,
  scene,
  selector,
  text,
  title,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import type { Todo } from './api'
import { type Model, init, update, view } from './application'
import { TodosBlock } from './todos'
import {
  AddTodo,
  GenerateTodo,
  RefreshTodos,
  ToggleAllTodos,
} from './todos/command'
import { PersistedTodos } from './todos/definition'

const urlFor = (href: string) => Option.getOrThrow(Url.fromString(href))

const withTodos = (todos: ReadonlyArray<Todo>, hash = '#/'): Model => {
  const start = init(urlFor(`http://localhost:5173/${hash}`)).model
  return {
    ...start,
    todos: {
      ...start.todos,
      persisted: PersistedTodos.Success({ data: todos }),
    },
  }
}

const fresh: Todo = { id: '9-z', title: 'Write the scene', completed: false }
const active: Todo = { id: '1-a', title: 'Active item', completed: false }
const done: Todo = { id: '2-b', title: 'Done item', completed: true }

const newTodoInput = placeholder('What needs to be done?')

describe('header to list', () => {
  test('Enter in the header adds a pending todo; a failed add keeps it with a retry', () => {
    scene(
      { update, view },
      given(withTodos([])),
      type(newTodoInput, '  Write the scene  '),
      keydown(newTodoInput, 'Enter'),
      expect(newTodoInput).toHaveValue(''),
      Command.expectExact(GenerateTodo),
      Command.resolve(
        GenerateTodo,
        TodosBlock.Message.GeneratedTodo({ todo: fresh }),
      ),
      expect(selector('li.todo.pending')).toExist(),
      expect(text('Write the scene')).toExist(),
      Command.resolve(
        AddTodo,
        TodosBlock.Message.FailedSaveTodos({ writeId: 0 }),
      ),
      Command.resolve(
        RefreshTodos,
        TodosBlock.Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [],
        }),
      ),
      expect(selector('li.todo.errored')).toExist(),
      expect(selector('li.todo.pending')).toBeAbsent(),
      click(title('Retry addTodo')),
      expect(selector('li.todo.pending.errored')).toExist(),
      Command.resolve(
        AddTodo,
        TodosBlock.Message.SucceededSaveTodos({ writeId: 1 }),
      ),
      Command.resolve(
        RefreshTodos,
        TodosBlock.Message.SucceededRefreshTodos({
          writeId: 1,
          refresh: 2,
          todos: [fresh],
        }),
      ),
      expect(selector('li.todo.errored')).toBeAbsent(),
      expect(text('Write the scene')).toExist(),
    )
  })

  test('a blank title adds nothing', () => {
    scene(
      { update, view },
      given(withTodos([])),
      type(newTodoInput, '   '),
      keydown(newTodoInput, 'Enter'),
      Command.expectNone(),
    )
  })
})

describe('list', () => {
  test('shows Loading until the first read lands', () => {
    scene(
      { update, view },
      given(init(urlFor('http://localhost:5173/')).model),
      expect(text('Loading…')).toExist(),
    )
  })

  test('toggle-all sends one bulk call and the count follows the overlay', () => {
    scene(
      { update, view },
      given(withTodos([active, fresh, done])),
      expect(selector('.todo-count')).toHaveText('2 items left'),
      change(label('Mark all as complete'), 'on'),
      expect(selector('.todo-count')).toHaveText('0 items left'),
      Command.resolve(
        ToggleAllTodos,
        TodosBlock.Message.SucceededSaveTodos({ writeId: 0 }),
      ),
      Command.resolve(
        RefreshTodos,
        TodosBlock.Message.SucceededRefreshTodos({
          writeId: 0,
          refresh: 1,
          todos: [
            { ...active, completed: true },
            { ...fresh, completed: true },
            done,
          ],
        }),
      ),
      expect(selector('.todo-count')).toHaveText('0 items left'),
      expect(selector('li.todo.pending')).toBeAbsent(),
    )
  })

  test('the hash filter limits the rendered items', () => {
    scene(
      { update, view },
      given(withTodos([active, done], '#/completed')),
      expect(text('Done item')).toExist(),
      expect(text('Active item')).toBeAbsent(),
      expect(selector('a.selected')).toHaveText('Completed'),
    )
  })
})
