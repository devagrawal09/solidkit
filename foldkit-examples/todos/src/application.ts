// The root: hash routing for the filter, the two feature Blocks, and the
// top-level crash view. Mirrors solid/examples/todos/src/app.tsx's <App>.

import { Effect, Layer, Schema } from 'effect'
import { Block, Navigation, type Runtime, Url } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { Filter, urlToFilter } from './filter'
import { NewTodoBlock } from './newTodo'
import { TodosBlock } from './todos'

export const Model = Schema.Struct({
  filter: Filter,
  newTodo: NewTodoBlock.Model,
  todos: TodosBlock.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedLink: { request: Navigation.UrlRequest },
  ChangedUrl: { url: Url.Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
})

export const ApplicationDefinition = Block.makeDefinition('Application', {
  Model,
  Message,
})

const { makeFieldsStep, makeNoopStep } = ApplicationDefinition

// BINDINGS

export const TodosBinding = ApplicationDefinition.makeBinding(TodosBlock, {
  field: 'todos',
})

/** Solid's <Header> calls `addTodo` through context. Here the header reports
 *  the fact and the parent turns it into the Todos Block's operation. */
export const NewTodoBinding = ApplicationDefinition.makeBinding(NewTodoBlock, {
  field: 'newTodo',
}).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(NewTodoBlock, {
    EnteredTitle: ({ title }) => TodosBinding.requestAddTodo({ title }),
  }),
})

export const ApplicationComposition = ApplicationDefinition.makeComposition({
  bindings: [NewTodoBinding, TodosBinding],
})

// COMMANDS

const NavigateInternal = ApplicationDefinition.makeCommand('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  handler: function* () {
    return ({ url }) =>
      Navigation.pushUrl(url).pipe(
        Effect.as(Message.CompletedNavigateInternal()),
      )
  },
})

const LoadExternal = ApplicationDefinition.makeCommand('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  handler: function* () {
    return ({ href }) =>
      Navigation.load(href).pipe(Effect.as(Message.CompletedLoadExternal()))
  },
})

// INIT, UPDATE, VIEW

export const init = ApplicationComposition.makeInit((url: Url.Url) => ({
  model: { filter: urlToFilter(url) },
}))

export const update = ApplicationComposition.makeUpdate({
  ClickedLink: (model, { request }) =>
    Navigation.UrlRequest.match(request, {
      Internal: ({ url }) => ({
        model,
        commands: [NavigateInternal({ url: Url.toString(url) })],
      }),
      External: ({ href }) => ({
        model,
        commands: [LoadExternal({ href })],
      }),
    }),
  ChangedUrl: makeFieldsStep.fromMessage(({ url }) => ({
    filter: () => urlToFilter(url),
  })),
  CompletedNavigateInternal: makeNoopStep(),
  CompletedLoadExternal: makeNoopStep(),
})

export const view = ApplicationComposition.makeView((model, h) => ({
  title: 'Foldkit Todos',
  body: h.block(
    TodosBinding.embedView({
      slotId: 'todos',
      model: model.todos,
      viewInputs: {
        filter: model.filter,
        renderHeader: () =>
          h.block(
            NewTodoBinding.embedView({
              slotId: 'new-todo',
              model: model.newTodo,
            }),
          ),
      },
    }),
  ),
}))

/** The top-level `<Errored>` boundary. Foldkit stops the Runtime on an
 *  unrecoverable error, so "Reset" reloads the page instead of re-rendering a
 *  subtree. */
export const crashView = (
  {
    error,
  }: Runtime.CrashContext<Model, typeof ApplicationComposition.Message.Type>,
  h: HtmlBuilder<never>,
): Document => ({
  title: 'Something went wrong',
  body: h.div(
    [h.Class('app-error')],
    [
      h.p([], [`Something went wrong: ${String(error)}`]),
      // The crash view renders after the Runtime stops, so no Message can be
      // dispatched; the rule's own guidance is to suppress it here.
      // oxlint-disable-next-line foldkit/no-raw-dom-event-attributes
      h.button([h.Attribute('onclick', 'location.reload()')], ['Reset']),
    ],
  ),
})

const prepare = () =>
  ApplicationComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(NavigateInternal.layer, LoadExternal.layer),
  })
export const ApplicationBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
