import { HashSet, Option, Result } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { Message } from './definition'
import { storiesQuery, storyQuery } from './query'
import {
  ApplicationRoute,
  pageHref,
  storyHref,
  urlToRoute,
  userHref,
} from './route'
import { type Feed, type StoryDefinition, type StorySummary } from './types'
import { init, shownRoute, update } from './update'

const urlFor = (path: string) =>
  Option.getOrThrow(Url.fromString(`http://localhost${path}`))

const summary = (id: number, title: string): StorySummary => ({
  id,
  points: Option.some(10),
  url: Option.some('https://example.com'),
  title,
  domain: Option.some('example.com'),
  type: 'link',
  time_ago: '1 hour ago',
  user: Option.some('pg'),
  comments_count: 3,
})

const storiesFetched = (
  feed: Feed,
  page: number,
  generation: number,
  stories: ReadonlyArray<StorySummary>,
) =>
  storiesQuery.Message.CompletedFetch({
    args: { feed, page },
    generation,
    requestKey: JSON.stringify({ feed, page }),
    result: Result.succeed(stories),
  })

const thread: StoryDefinition = {
  ...summary(9, 'A thread'),
  comments: [],
}

// Nothing loads for an unknown path, so each story starts with no Commands.
const start = init(urlFor('/nowhere/at/all')).model

describe('routes', () => {
  test('parse the original route table', () => {
    expect(urlToRoute(urlFor('/'))).toEqual(
      ApplicationRoute.Top({ page: Option.none() }),
    )
    expect(urlToRoute(urlFor('/new?page=2'))).toEqual(
      ApplicationRoute.Feed({ feed: 'new', page: Option.some(2) }),
    )
    expect(urlToRoute(urlFor('/stories/123'))).toEqual(
      ApplicationRoute.Story({ id: '123' }),
    )
    expect(urlToRoute(urlFor('/users/pg'))).toEqual(
      ApplicationRoute.User({ id: 'pg' }),
    )
    expect(urlToRoute(urlFor('/best'))._tag).toBe('NotFound')
  })

  test('build hrefs with the same routers', () => {
    expect(pageHref('top', 2)).toBe('/top?page=2')
    expect(storyHref(42)).toBe('/stories/42')
    expect(userHref('pg')).toBe('/users/pg')
  })
})

describe('navigation', () => {
  test('the current page stays on screen until the next route has data', () => {
    story(
      update,
      given(start),
      message(Message.ChangedUrl({ url: urlFor('/') })),
      Command.resolve(
        storiesQuery.Fetch,
        storiesFetched('top', 1, 1, [summary(1, 'One')]),
      ),
      model(current => {
        expect(shownRoute(current)._tag).toBe('Top')
      }),
      message(Message.ChangedUrl({ url: urlFor('/new') })),
      model(current => {
        expect(current.route._tag).toBe('Feed')
        expect(shownRoute(current)._tag).toBe('Top')
      }),
      Command.resolve(
        storiesQuery.Fetch,
        storiesFetched('new', 1, 2, [summary(2, 'Two')]),
      ),
      model(current => {
        expect(shownRoute(current)).toEqual(
          ApplicationRoute.Feed({ feed: 'new', page: Option.none() }),
        )
      }),
      // Going back to a retained page needs no request.
      message(Message.ChangedUrl({ url: urlFor('/') })),
      Command.expectNone(),
      model(current => {
        expect(shownRoute(current)._tag).toBe('Top')
      }),
    )
  })

  test('hovering a link preloads its data without navigating', () => {
    story(
      update,
      given(start),
      message(
        Message.ShowedLinkIntent({
          route: ApplicationRoute.Story({ id: '9' }),
        }),
      ),
      Command.expectHas(storyQuery.Fetch),
      model(current => {
        expect(current.route._tag).toBe('NotFound')
      }),
      Command.resolve(
        storyQuery.Fetch,
        storyQuery.Message.CompletedFetch({
          args: { id: '9' },
          generation: 1,
          requestKey: JSON.stringify({ id: '9' }),
          result: Result.succeed(thread),
        }),
      ),
      message(Message.ChangedUrl({ url: urlFor('/stories/9') })),
      // The click finds the data already retained: no request, no wait.
      Command.expectNone(),
      model(current => {
        expect(shownRoute(current)).toEqual(ApplicationRoute.Story({ id: '9' }))
      }),
    )
  })

  test('a failed load is shown, and Try again requests it again', () => {
    story(
      update,
      given(start),
      message(Message.ChangedUrl({ url: urlFor('/ask') })),
      Command.resolve(
        storiesQuery.Fetch,
        storiesQuery.Message.CompletedFetch({
          args: { feed: 'ask', page: 1 },
          generation: 1,
          requestKey: JSON.stringify({ feed: 'ask', page: 1 }),
          result: Result.fail('503 from node-hnapi'),
        }),
      ),
      model(current => {
        expect(shownRoute(current)._tag).toBe('Feed')
      }),
      message(Message.ClickedRetry()),
      Command.expectHas(storiesQuery.Fetch),
      Command.resolve(
        storiesQuery.Fetch,
        storiesFetched('ask', 1, 2, [summary(3, 'Ask HN')]),
      ),
    )
  })
})

describe('comments', () => {
  test('a comment thread collapses and expands', () => {
    story(
      update,
      given(start),
      message(Message.ClickedCommentToggle({ id: 7 })),
      model(current => {
        expect(HashSet.has(current.collapsedComments, 7)).toBe(true)
      }),
      message(Message.ClickedCommentToggle({ id: 7 })),
      model(current => {
        expect(HashSet.has(current.collapsedComments, 7)).toBe(false)
      }),
    )
  })
})
