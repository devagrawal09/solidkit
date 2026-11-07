// One KeyedQuery per resource, replacing the original's `query(...)`
// wrappers. Each retains an AsyncData entry per key (feed + page, story id,
// user id), dedupes in-flight requests, and ignores late responses. The
// parent decides when to load: on route entry, and on link hover/focus.

import { Schema } from 'effect'
import { Query } from 'foldkit/experimental'

import { HnApi } from './hnApi'
import { Feed, MaybeUser, StoryDefinition, StorySummary } from './types'

export const storiesQuery = Query.define({
  name: 'Stories',
  args: { feed: Feed, page: Schema.Number },
  data: Schema.Array(StorySummary),
  error: Schema.String,
  handler: function* () {
    const api = yield* HnApi
    return ({ feed, page }) => api.getStories(feed, page)
  },
})

export const storyQuery = Query.define({
  name: 'Story',
  args: { id: Schema.String },
  data: StoryDefinition,
  error: Schema.String,
  handler: function* () {
    const api = yield* HnApi
    return ({ id }) => api.getStory(id)
  },
})

export const userQuery = Query.define({
  name: 'User',
  args: { id: Schema.String },
  data: MaybeUser,
  error: Schema.String,
  handler: function* () {
    const api = yield* HnApi
    return ({ id }) => api.getUser(id)
  },
})
