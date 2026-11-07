// Markup follows solid/examples/hackernews-spa: components/nav.tsx,
// components/story.tsx, components/comment.tsx and routes/*.tsx. These are
// stateless render helpers, not Blocks; the state they show lives in the
// root Model (route, collapsed comments) and the three KeyedQueries.

import { Array, HashSet, Option, String } from 'effect'
import { AsyncData, type Runtime } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  ApplicationComposition,
  type ApplicationViewBuilder,
} from './composition'
import { Message, type Model } from './definition'
import { storiesQuery, storyQuery, userQuery } from './query'
import {
  ApplicationRoute,
  type FeedPage,
  feedPageOf,
  feedRouter,
  pageHref,
  storyHref,
  topRouter,
  userHref,
} from './route'
import type {
  CommentDefinition,
  StoryDefinition,
  StorySummary,
  UserDefinition,
} from './types'
import { shownRoute } from './update'

// NAV

const navView = (h: ApplicationViewBuilder): Html =>
  h.header(
    [h.Class('header')],
    [
      h.nav(
        [h.Class('inner')],
        [
          h.a(
            [h.Href(topRouter({ page: Option.none() }))],
            [h.strong([], ['HN'])],
          ),
          h.a(
            [h.Href(feedRouter({ feed: 'new', page: Option.none() }))],
            [h.strong([], ['New'])],
          ),
          h.a(
            [h.Href(feedRouter({ feed: 'show', page: Option.none() }))],
            [h.strong([], ['Show'])],
          ),
          h.a(
            [h.Href(feedRouter({ feed: 'ask', page: Option.none() }))],
            [h.strong([], ['Ask'])],
          ),
          h.a(
            [h.Href(feedRouter({ feed: 'job', page: Option.none() }))],
            [h.strong([], ['Jobs'])],
          ),
          h.a(
            [
              h.Class('github'),
              h.Href('https://github.com/foldkit/foldkit'),
              h.Target('_blank'),
              h.Rel('noreferrer'),
            ],
            ['Built with Foldkit'],
          ),
        ],
      ),
    ],
  )

// STORY ROW

/** node-hnapi gives Ask and text posts a relative `item?id=...` url. */
const isItemUrl = (url: string): boolean => String.startsWith('item?id=')(url)

const storyTitleView = (story: StorySummary, h: ApplicationViewBuilder) =>
  Option.match(
    Option.filter(story.url, url => !isItemUrl(url)),
    {
      onNone: () => [h.a([h.Href(storyHref(story.id))], [story.title])],
      onSome: url => [
        h.a(
          [h.Href(url), h.Target('_blank'), h.Rel('noreferrer')],
          [story.title],
        ),
        Option.match(story.domain, {
          onNone: () => h.empty,
          onSome: domain => h.span([h.Class('host')], [` (${domain})`]),
        }),
      ],
    },
  )

const userLink = (
  maybeUser: Option.Option<string>,
  h: ApplicationViewBuilder,
) =>
  Option.match(maybeUser, {
    onNone: () => h.empty,
    onSome: user => h.a([h.Href(userHref(user))], [user]),
  })

const storyItemView = (story: StorySummary, h: ApplicationViewBuilder): Html =>
  h.keyed('li')(
    globalThis.String(story.id),
    [h.Class('news-item')],
    [
      h.span(
        [h.Class('score')],
        [
          Option.match(story.points, {
            onNone: () => '',
            onSome: globalThis.String,
          }),
        ],
      ),
      h.span([h.Class('title')], storyTitleView(story, h)),
      h.br([]),
      h.span(
        [h.Class('meta')],
        story.type === 'job'
          ? [h.a([h.Href(storyHref(story.id))], [story.time_ago])]
          : [
              'by ',
              userLink(story.user, h),
              ` ${story.time_ago} | `,
              h.a(
                [h.Href(storyHref(story.id))],
                [
                  story.comments_count > 0
                    ? `${story.comments_count} comments`
                    : 'discuss',
                ],
              ),
            ],
      ),
      story.type === 'link'
        ? h.empty
        : h.span([h.Class('label')], [story.type]),
    ],
  )

// STORIES ROUTE

const storiesView = (
  { feed, page }: FeedPage,
  stories: ReadonlyArray<StorySummary>,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('news-view')],
    [
      h.div(
        [h.Class('news-list-nav')],
        [
          page > 1
            ? h.a(
                [
                  h.Class('page-link'),
                  h.Href(pageHref(feed, page - 1)),
                  h.AriaLabel('Previous Page'),
                ],
                ['< prev'],
              )
            : h.span(
                [h.Class('page-link disabled'), h.AriaDisabled(true)],
                ['< prev'],
              ),
          h.span([], [`page ${page}`]),
          stories.length >= 29
            ? h.a(
                [
                  h.Class('page-link'),
                  h.Href(pageHref(feed, page + 1)),
                  h.AriaLabel('Next Page'),
                ],
                ['more >'],
              )
            : h.span(
                [h.Class('page-link disabled'), h.AriaDisabled(true)],
                ['more >'],
              ),
        ],
      ),
      h.main(
        [h.Class('news-list')],
        Array.map(stories, story => storyItemView(story, h)),
      ),
    ],
  )

// COMMENTS

const commentView = (
  comment: CommentDefinition,
  collapsed: HashSet.HashSet<number>,
  h: ApplicationViewBuilder,
): Html =>
  h.keyed('li')(
    globalThis.String(comment.id),
    [h.Class('comment')],
    [
      h.div(
        [h.Class('by')],
        [userLink(comment.user, h), ` ${comment.time_ago}`],
      ),
      h.div([
        h.Class('text'),
        h.InnerHTML(Option.getOrElse(comment.content, () => '')),
      ]),
      Array.isReadonlyArrayNonEmpty(comment.comments)
        ? h.details(
            [h.Class('toggle'), h.Open(!HashSet.has(collapsed, comment.id))],
            [
              h.summary(
                [
                  // The open state lives in the Model, so the native toggle is
                  // prevented and the click becomes a Message.
                  h.OnClick(Message.ClickedCommentToggle({ id: comment.id }), {
                    defaultAction: 'Prevent',
                  }),
                ],
                [
                  h.span([h.Class('open-label')], ['[-]']),
                  h.span([h.Class('closed-label')], ['[+] comments collapsed']),
                ],
              ),
              h.ul(
                [h.Class('comment-children')],
                Array.map(comment.comments, child =>
                  commentView(child, collapsed, h),
                ),
              ),
            ],
          )
        : h.empty,
    ],
  )

// STORY ROUTE

const storyView = (
  story: StoryDefinition,
  collapsed: HashSet.HashSet<number>,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('item-view')],
    [
      h.div(
        [h.Class('item-view-header')],
        [
          h.a(
            [
              h.Href(
                Option.getOrElse(
                  Option.filter(story.url, url => !isItemUrl(url)),
                  () => storyHref(story.id),
                ),
              ),
              h.Target('_blank'),
              h.Rel('noreferrer'),
            ],
            [h.h1([], [story.title])],
          ),
          Option.match(story.domain, {
            onNone: () => h.empty,
            onSome: domain => h.span([h.Class('host')], [`(${domain})`]),
          }),
          h.p(
            [h.Class('meta')],
            [
              `${Option.match(story.points, { onNone: () => '', onSome: globalThis.String })} points | by `,
              userLink(story.user, h),
              ` ${story.time_ago}`,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('item-view-comments')],
        [
          h.p(
            [h.Class('item-view-comments-header')],
            [
              story.comments_count > 0
                ? `${story.comments_count} comments`
                : 'No comments yet.',
            ],
          ),
          h.ul(
            [h.Class('comment-children')],
            Array.map(story.comments, comment =>
              commentView(comment, collapsed, h),
            ),
          ),
        ],
      ),
    ],
  )

// USER ROUTE

const userView = (
  maybeUser: Option.Option<UserDefinition>,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('user-view')],
    Option.match(maybeUser, {
      onNone: () => [h.h1([], ['User not found.'])],
      onSome: user => [
        h.h1([], [`User : ${user.id}`]),
        h.ul(
          [h.Class('meta')],
          [
            h.li(
              [],
              [h.span([h.Class('label')], ['Created:']), ` ${user.created}`],
            ),
            h.li(
              [],
              [h.span([h.Class('label')], ['Karma:']), ` ${user.karma}`],
            ),
            Option.match(user.about, {
              onNone: () => h.empty,
              onSome: about => h.li([h.Class('about'), h.InnerHTML(about)]),
            }),
          ],
        ),
        h.p(
          [h.Class('links')],
          [
            h.a(
              [h.Href(`https://news.ycombinator.com/submitted?id=${user.id}`)],
              ['submissions'],
            ),
            ' | ',
            h.a(
              [h.Href(`https://news.ycombinator.com/threads?id=${user.id}`)],
              ['comments'],
            ),
          ],
        ),
      ],
    }),
  )

// PAGE

/** The original's <Loading> fallback. */
const loadingView = (h: ApplicationViewBuilder): Html =>
  h.div([h.Class('news-list-nav')], ['Loading...'])

/** Not in the original (which has no error boundary): a failed request after
 *  retries, with a way to try again. */
const failureView = (error: string, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('news-list-nav')],
    [
      h.span([], [`Could not load this page. ${error} `]),
      h.button([h.OnClick(Message.ClickedRetry())], ['Try again']),
    ],
  )

const pageView = (model: Model, h: ApplicationViewBuilder): Html => {
  const route = shownRoute(model)
  const whenLoaded = <A>(
    data: AsyncData.AsyncData<A, string>,
    onData: (value: A) => Html,
  ): Html =>
    AsyncData.matchData(data, {
      onEmpty: () => loadingView(h),
      onFailure: error => failureView(error, h),
      onData,
    })

  return ApplicationRoute.match(route, {
    Top: () => feedView(model, route, h),
    Feed: () => feedView(model, route, h),
    Story: ({ id }) =>
      whenLoaded(storyQuery.read(model.story, { id }), story =>
        storyView(story, model.collapsedComments, h),
      ),
    User: ({ id }) =>
      whenLoaded(userQuery.read(model.user, { id }), maybeUser =>
        userView(maybeUser, h),
      ),
    NotFound: () => h.div([h.Class('news-list-nav')], ['Page not found.']),
  })

  function feedView(
    current: Model,
    feedRoute: ApplicationRoute,
    builder: ApplicationViewBuilder,
  ): Html {
    return Option.match(feedPageOf(feedRoute), {
      onNone: () => loadingView(builder),
      onSome: feedPage =>
        whenLoaded(storiesQuery.read(current.stories, feedPage), stories =>
          storiesView(feedPage, stories, builder),
        ),
    })
  }
}

export const view = ApplicationComposition.makeView((model, h) => ({
  title: 'Foldkit HackerNews',
  body: h.div([], [navView(h), h.div([h.Class('page')], [pageView(model, h)])]),
}))

export const crashView = (
  {
    error,
  }: Runtime.CrashContext<Model, typeof ApplicationComposition.Message.Type>,
  h: HtmlBuilder<never>,
): Document => ({
  title: 'Something went wrong',
  body: h.div(
    [h.Class('news-list-nav')],
    [h.p([], [`Something went wrong: ${globalThis.String(error)}`])],
  ),
})
