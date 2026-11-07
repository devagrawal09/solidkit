import { Effect, Layer, Schema } from 'effect'
import { Navigation } from 'foldkit'

import { ApplicationDefinition, Message } from './definition'

export const NavigateInternal = ApplicationDefinition.makeCommand(
  'NavigateInternal',
  {
    args: { url: Schema.String },
    messages: [Message.CompletedNavigateInternal],
    handler: function* () {
      return ({ url }) =>
        Navigation.pushUrl(url).pipe(
          Effect.as(Message.CompletedNavigateInternal()),
        )
    },
  },
)

export const LoadExternal = ApplicationDefinition.makeCommand('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  handler: function* () {
    return ({ href }) =>
      Navigation.load(href).pipe(Effect.as(Message.CompletedLoadExternal()))
  },
})

/** The original's router resets the scroll position on navigation. */
export const ScrollToTop = ApplicationDefinition.makeCommand('ScrollToTop', {
  messages: [Message.CompletedScrollToTop],
  handler: function* () {
    return () =>
      Effect.sync(() => {
        window.scrollTo(0, 0)
        return Message.CompletedScrollToTop()
      })
  },
})

export const EffectsLayer = Layer.mergeAll(
  NavigateInternal.layer,
  LoadExternal.layer,
  ScrollToTop.layer,
)
