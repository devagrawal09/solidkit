// The original's <LogPanel>: every fiber lifecycle event, newest first.
//
// Entries arrive through a Subscription on the EventLog Service's stream, so
// they enter the Model as Messages (and show up in DevTools) like any other
// fact. The Stream has no Model dependencies, so it runs for the life of the
// Block occurrence.

import { Array, Schema, Stream } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { EventLog, LogEntry } from './eventLog'

const MAX_ENTRIES = 100

export const Model = Schema.Struct({ entries: Schema.Array(LogEntry) })
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  LoggedFiberEvent: { entry: LogEntry },
  ClickedClear: {},
})

const LogPanelDefinition = Block.makeDefinition('LogPanel', {
  Model,
  Message,
})

const LogPanelComposition = LogPanelDefinition.makeComposition()

export const subscriptions = LogPanelDefinition.makeSubscriptions(entry => ({
  fiberEvents: entry('FiberEvents', {
    messages: [Message.LoggedFiberEvent],
    handler: function* () {
      const eventLog = yield* EventLog
      return () =>
        eventLog.entries.pipe(
          Stream.map(logEntry => Message.LoggedFiberEvent({ entry: logEntry })),
        )
    },
  }),
}))

export const init = LogPanelComposition.makeInit(() => ({
  model: Model.make({ entries: [] }),
}))

export const update = LogPanelComposition.makeUpdate({
  LoggedFiberEvent: (model, { entry }) => ({
    model: modifyFields(model, {
      entries: entries =>
        Array.takeRight(Array.append(entries, entry), MAX_ENTRIES),
    }),
  }),
  ClickedClear: model => ({
    model: modifyFields(model, { entries: () => [] }),
  }),
})

const view = LogPanelComposition.makeView((model, h) =>
  h.aside(
    [h.Class('log-panel')],
    [
      h.header(
        [],
        [
          h.h2([], ['Fiber events']),
          h.button([h.OnClick(Message.ClickedClear())], ['Clear']),
        ],
      ),
      Array.isReadonlyArrayNonEmpty(model.entries)
        ? h.ul(
            [],
            Array.map(Array.reverse(model.entries), logEntry =>
              h.keyed('li')(
                globalThis.String(logEntry.id),
                [h.Class(`log-${logEntry.kind}`)],
                [
                  h.span([h.Class('log-time')], [logEntry.time]),
                  h.span([h.Class('log-kind')], [logEntry.kind]),
                  h.span([h.Class('log-msg')], [logEntry.message]),
                ],
              ),
            ),
          )
        : h.p([h.Class('empty')], ['Interact to see fiber lifecycle events.']),
    ],
  ),
)

const prepare = () =>
  LogPanelComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer: subscriptions.layer,
  })
export const LogPanelBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
