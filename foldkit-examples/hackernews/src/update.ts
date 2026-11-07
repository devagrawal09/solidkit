import { HashSet, Option } from 'effect'
import { type AsyncData, Navigation, Update, Url } from 'foldkit'

import { LoadExternal, NavigateInternal, ScrollToTop } from './command'
import {
  ApplicationComposition,
  StoriesBinding,
  StoryBinding,
  UserBinding,
} from './composition'
import { type Model, makeFieldsStep, makeNoopStep } from './definition'
import { storiesQuery, storyQuery, userQuery } from './query'
import { ApplicationRoute, pageNumber, urlToRoute } from './route'

/** The original's per-route `preload`: load what a route shows unless the
 *  KeyedQuery already retains it. */
export const loadRouteStep = (route: ApplicationRoute) =>
  ApplicationRoute.match(route, {
    Top: ({ page }) =>
      StoriesBinding.requestLoadIfMissing({
        feed: 'top',
        page: pageNumber(page),
      }),
    Feed: ({ feed, page }) =>
      StoriesBinding.requestLoadIfMissing({ feed, page: pageNumber(page) }),
    Story: ({ id }) => StoryBinding.requestLoadIfMissing({ id }),
    User: ({ id }) => UserBinding.requestLoadIfMissing({ id }),
    NotFound: () => makeNoopStep(),
  })

const isSettledData = (data: AsyncData.AsyncData<unknown, unknown>): boolean =>
  data._tag !== 'Idle' && data._tag !== 'Loading'

/** A route can be shown once its data has arrived or failed. */
export const isSettled = (model: Model, route: ApplicationRoute): boolean =>
  ApplicationRoute.match(route, {
    Top: ({ page }) =>
      isSettledData(
        storiesQuery.read(model.stories, {
          feed: 'top',
          page: pageNumber(page),
        }),
      ),
    Feed: ({ feed, page }) =>
      isSettledData(
        storiesQuery.read(model.stories, { feed, page: pageNumber(page) }),
      ),
    Story: ({ id }) => isSettledData(storyQuery.read(model.story, { id })),
    User: ({ id }) => isSettledData(userQuery.read(model.user, { id })),
    NotFound: () => true,
  })

/** The page on screen. The URL's route once its data has settled; until
 *  then, the page it is replacing, so a navigation never flashes "Loading". */
export const shownRoute = (model: Model): ApplicationRoute =>
  isSettled(model, model.route)
    ? model.route
    : Option.getOrElse(
        Option.filter(model.maybePreviousRoute, previous =>
          isSettled(model, previous),
        ),
        () => model.route,
      )

export const init = ApplicationComposition.makeInit((url: Url.Url) => {
  const route = urlToRoute(url)
  return {
    model: {
      route,
      maybePreviousRoute: Option.none(),
      collapsedComments: HashSet.empty<number>(),
    },
    steps: [loadRouteStep(route)],
  }
})

export const update = ApplicationComposition.makeUpdate({
  ClickedLink: (model, { request }) =>
    Navigation.UrlRequest.match(request, {
      Internal: ({ url }) => ({
        model,
        commands: [NavigateInternal({ url: Url.toString(url) }), ScrollToTop()],
      }),
      External: ({ href }) => ({
        model,
        commands: [LoadExternal({ href })],
      }),
    }),

  ChangedUrl: (model, { url }) => {
    const route = urlToRoute(url)
    return Update.combineSteps(model, [
      makeFieldsStep(current => ({
        maybePreviousRoute: () => Option.some(shownRoute(current)),
        route: () => route,
      })),
      loadRouteStep(route),
    ])
  },

  ShowedLinkIntent: (model, { route }) =>
    Update.combineSteps(model, [loadRouteStep(route)]),

  ClickedCommentToggle: makeFieldsStep.fromMessage(({ id }) => ({
    collapsedComments: collapsed =>
      HashSet.has(collapsed, id)
        ? HashSet.remove(collapsed, id)
        : HashSet.add(collapsed, id),
  })),

  ClickedRetry: model =>
    Update.combineSteps(model, [loadRouteStep(model.route)]),

  CompletedNavigateInternal: makeNoopStep(),
  CompletedLoadExternal: makeNoopStep(),
  CompletedScrollToTop: makeNoopStep(),
})
