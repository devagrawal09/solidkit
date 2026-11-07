// The original's route table (app.tsx), as typed bidirectional routes: the
// same routers parse URLs and build hrefs, so links cannot drift from routes.
//
//   /            top stories, ?page=N
//   /:type       top | new | show | ask | job, ?page=N
//   /stories/:id
//   /users/:id

import { Option, Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import {
  defineRouteUnion,
  literal,
  schemaSegment,
  slash,
  string,
} from 'foldkit/route'

import { Feed } from './types'

export const ApplicationRoute = defineRouteUnion({
  Top: { page: Schema.Option(Schema.Number) },
  Feed: { feed: Feed, page: Schema.Option(Schema.Number) },
  Story: { id: Schema.String },
  User: { id: Schema.String },
  NotFound: { path: Schema.String },
})
export type ApplicationRoute = typeof ApplicationRoute.Type

const pageQuery = Route.query(
  Schema.Struct({ page: Schema.OptionFromOptional(Schema.FiniteFromString) }),
)

export const topRouter = pipe(
  Route.root,
  pageQuery,
  Route.mapTo(ApplicationRoute.Top),
)

export const feedRouter = pipe(
  schemaSegment('feed', Feed),
  pageQuery,
  Route.mapTo(ApplicationRoute.Feed),
)

export const storyRouter = pipe(
  literal('stories'),
  slash(string('id')),
  Route.mapTo(ApplicationRoute.Story),
)

export const userRouter = pipe(
  literal('users'),
  slash(string('id')),
  Route.mapTo(ApplicationRoute.User),
)

const routeParser = Route.oneOf(storyRouter, userRouter, feedRouter, topRouter)

export const urlToRoute = Route.parseUrlWithFallback(
  routeParser,
  ApplicationRoute.NotFound,
)

/** The original reads `Number(query.page) || 1`. */
export const pageNumber = (maybePage: Option.Option<number>): number =>
  Option.match(maybePage, {
    onNone: () => 1,
    onSome: page => (Number.isInteger(page) && page >= 1 ? page : 1),
  })

export type FeedPage = Readonly<{ feed: Feed; page: number }>

/** `/` is the top feed. */
export const feedPageOf = (route: ApplicationRoute): Option.Option<FeedPage> =>
  ApplicationRoute.match(route, {
    Top: ({ page }) =>
      Option.some({ feed: 'top' as const, page: pageNumber(page) }),
    Feed: ({ feed, page }) => Option.some({ feed, page: pageNumber(page) }),
    Story: () => Option.none(),
    User: () => Option.none(),
    NotFound: () => Option.none(),
  })

export const pageHref = (feed: Feed, page: number): string =>
  feedRouter({ feed, page: Option.some(page) })

export const storyHref = (id: number | string): string =>
  storyRouter({ id: String(id) })

export const userHref = (id: string): string => userRouter({ id })
