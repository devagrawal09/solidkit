// The original's <Header>: a text input that calls `addTodo` from context on
// Enter. As a Block it owns its draft text and reports the entered title as
// an OutMessage; the parent decides that this means "add a todo".

import { Option, Schema, String } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

export const Model = Schema.Struct({ draft: Schema.String })

export const Message = defineMessageUnion({
  ChangedDraft: { text: Schema.String },
  PressedEnter: {},
})

export const OutMessage = defineMessageUnion({
  EnteredTitle: { title: Schema.String },
})

const NewTodoDefinition = Block.makeDefinition('NewTodo', {
  Model,
  Message,
  OutMessage,
})

const { makeFieldsStep } = NewTodoDefinition

const NewTodoComposition = NewTodoDefinition.makeComposition()

const init = NewTodoComposition.makeInit(() => ({
  model: Model.make({ draft: '' }),
}))

const update = NewTodoComposition.makeUpdate({
  ChangedDraft: makeFieldsStep.fromMessage(({ text }) => ({
    draft: () => text,
  })),
  PressedEnter: model => {
    const title = String.trim(model.draft)
    if (String.isEmpty(title)) {
      return { model }
    }
    return {
      model: modifyFields(model, { draft: () => '' }),
      outMessage: OutMessage.EnteredTitle({ title }),
    }
  },
})

const view = NewTodoComposition.makeView((model, h) =>
  h.header(
    [h.Class('header')],
    [
      h.h1([], ['todos']),
      h.input([
        h.Class('new-todo'),
        h.Placeholder('What needs to be done?'),
        h.Autofocus(true),
        h.Value(model.draft),
        h.OnInput(text => Message.ChangedDraft({ text })),
        h.OnKeyDownPreventDefault(key =>
          key === 'Enter' ? Option.some(Message.PressedEnter()) : Option.none(),
        ),
      ]),
    ],
  ),
)

const prepare = () =>
  NewTodoComposition.prepareBlock({
    init,
    update,
    view,
  })
export const NewTodoBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
