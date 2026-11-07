// The root, as in solid/examples/effect/src/app.tsx: two demo tabs and the
// fiber event log. The original provides Effect services through a
// ManagedRuntime on Solid context; here every Service lives in
// `ApplicationLayer` (services.ts), supplied once below all handler Layers.

import { Schema } from 'effect'
import { Block, type Runtime } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { CheckoutBlock } from './checkout'
import { LogPanelBlock } from './logPanel'
import { TypeaheadBlock } from './typeahead'

export const Tab = Schema.Literals(['Typeahead', 'Checkout'])
export type Tab = typeof Tab.Type

export const Model = Schema.Struct({
  tab: Tab,
  typeahead: TypeaheadBlock.Model,
  checkout: CheckoutBlock.Model,
  logPanel: LogPanelBlock.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedTab: { tab: Tab },
})

const ApplicationDefinition = Block.makeDefinition('Application', {
  Model,
  Message,
})

const { makeFieldsStep } = ApplicationDefinition

// Each demo keeps its Model while the other tab is shown (the original
// unmounts the hidden tab, which resets it).
const TypeaheadBinding = ApplicationDefinition.makeBinding(TypeaheadBlock, {
  field: 'typeahead',
})
const CheckoutBinding = ApplicationDefinition.makeBinding(CheckoutBlock, {
  field: 'checkout',
})
const LogPanelBinding = ApplicationDefinition.makeBinding(LogPanelBlock, {
  field: 'logPanel',
})

export const ApplicationComposition = ApplicationDefinition.makeComposition({
  bindings: [TypeaheadBinding, CheckoutBinding, LogPanelBinding],
})

export const init = ApplicationComposition.makeInit(() => ({
  model: { tab: 'Typeahead' },
}))

export const update = ApplicationComposition.makeUpdate({
  ClickedTab: makeFieldsStep.fromMessage(({ tab }) => ({ tab: () => tab })),
})

export const view = ApplicationComposition.makeView((model, h) => {
  const tabButton = (tab: Tab, label: string, hint: string) =>
    h.button(
      [
        h.Class(model.tab === tab ? 'selected' : ''),
        h.OnClick(Message.ClickedTab({ tab })),
      ],
      [`${label} `, h.small([], [hint])],
    )

  return {
    title: 'Foldkit × Effect',
    body: h.div(
      [h.Class('app')],
      [
        h.header(
          [h.Class('app-header')],
          [
            h.h1(
              [],
              ['Foldkit ', h.span([h.Class('times')], ['×']), ' Effect'],
            ),
            h.p(
              [],
              [
                'Two demos, no integration layer: Effect programs run as Commands whose handlers live in Layers, interruption is a Command (',
                h.code([], ['Command.Interrupt']),
                '), and Services are provided once through the Program’s ',
                h.code([], ['ApplicationLayer']),
                '.',
              ],
            ),
            h.nav(
              [h.Class('tabs')],
              [
                tabButton('Typeahead', 'Typeahead', 'read path'),
                tabButton('Checkout', 'Checkout', 'action path'),
              ],
            ),
          ],
        ),
        h.main(
          [],
          [
            model.tab === 'Typeahead'
              ? h.block(
                  TypeaheadBinding.embedView({
                    slotId: 'typeahead',
                    model: model.typeahead,
                  }),
                )
              : h.block(
                  CheckoutBinding.embedView({
                    slotId: 'checkout',
                    model: model.checkout,
                  }),
                ),
            h.block(
              LogPanelBinding.embedView({
                slotId: 'log-panel',
                model: model.logPanel,
              }),
            ),
          ],
        ),
      ],
    ),
  }
})

/** The original's top-level `<Errored>` boundary. */
export const crashView = (
  {
    error,
  }: Runtime.CrashContext<Model, typeof ApplicationComposition.Message.Type>,
  h: HtmlBuilder<never>,
): Document => ({
  title: 'Something went wrong',
  body: h.div(
    [h.Class('error-box app-error')],
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
  })
export const ApplicationBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
