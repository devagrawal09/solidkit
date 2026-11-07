import { Schema } from 'effect'
import { Block, Navigation, Url } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { storiesQuery, storyQuery, userQuery } from './query'
import { ApplicationRoute } from './route'

export const Model = Schema.Struct({
  route: ApplicationRoute,
  /** The page kept on screen while `route`'s data loads, as the original's
   *  router keeps the current page up during a navigation. */
  maybePreviousRoute: Schema.Option(ApplicationRoute),
  /** Comment ids whose replies are collapsed (the original's <details>). */
  collapsedComments: Schema.HashSet(Schema.Number),
  stories: storiesQuery.Model,
  story: storyQuery.Model,
  user: userQuery.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedLink: { request: Navigation.UrlRequest },
  ChangedUrl: { url: Url.Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedScrollToTop: {},
  ShowedLinkIntent: { route: ApplicationRoute },
  ClickedCommentToggle: { id: Schema.Number },
  ClickedRetry: {},
})

export const ApplicationDefinition = Block.makeDefinition('Application', {
  Model,
  Message,
})

export const { makeFieldsStep, makeNoopStep } = ApplicationDefinition
