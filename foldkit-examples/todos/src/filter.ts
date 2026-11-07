// Port of solid/examples/todos/src/filter.ts.
//
// The original mirrors `location.hash` into a signal with its own
// `hashchange` listener. Here the Program's routing delivers every URL change
// (link clicks, back/forward) to the root update as `ChangedUrl`, and the
// root stores the parsed filter in its Model.

import { Option, Schema } from 'effect'
import type { Url } from 'foldkit/url'

export const Filter = Schema.Literals(['All', 'Active', 'Completed'])
export type Filter = typeof Filter.Type

/** `#/active` and `#/completed` select a filter; anything else is "all". */
export const urlToFilter = (url: Url): Filter =>
  Option.match(url.hash, {
    onNone: () => 'All',
    onSome: hash => {
      if (hash === '/active') {
        return 'Active'
      }
      if (hash === '/completed') {
        return 'Completed'
      }
      return 'All'
    },
  })

export const filterHref = (filter: Filter): string => {
  if (filter === 'Active') {
    return '#/active'
  }
  if (filter === 'Completed') {
    return '#/completed'
  }
  return '#/'
}
