// Preload on hover and focus, like the original's `intentPreload()`: one
// delegated listener on the document maps the link under the pointer (or
// keyboard focus) to a route. Update then loads that route's data if it is
// missing, so the click finds it in the KeyedQuery.

import { Option, Stream } from 'effect'
import { Dom, Url } from 'foldkit'

import { ApplicationDefinition, Message } from './definition'
import { type ApplicationRoute, urlToRoute } from './route'

const linkRoute = (event: Event): Option.Option<ApplicationRoute> => {
  const target = event.target
  if (!(target instanceof Element)) {
    return Option.none()
  }
  const link = target.closest('a[href]')
  if (
    !(link instanceof HTMLAnchorElement) ||
    link.target === '_blank' ||
    link.origin !== window.location.origin
  ) {
    return Option.none()
  }
  return Option.filter(
    Option.map(Url.fromString(link.href), urlToRoute),
    route => route._tag !== 'NotFound',
  )
}

const intents = (type: 'mouseover' | 'focusin') =>
  Dom.streamFromEventFilterMap({
    target: () => document,
    type,
    filterMapEvent: linkRoute,
  })

export const subscriptions = ApplicationDefinition.makeSubscriptions(entry => ({
  linkIntent: entry('LinkIntent', {
    messages: [Message.ShowedLinkIntent],
    handler: function* () {
      return () =>
        Stream.merge(intents('mouseover'), intents('focusin')).pipe(
          Stream.changesWith(
            (previous, next) =>
              JSON.stringify(previous) === JSON.stringify(next),
          ),
          Stream.map(route => Message.ShowedLinkIntent({ route })),
        )
    },
  }),
}))
