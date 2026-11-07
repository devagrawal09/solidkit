import { Option, Result } from 'effect'
import { Url } from 'foldkit'
import {
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { toParentMessage } from 'foldkit/test'
import { describe, test } from 'vitest'

import { StoryBinding } from './composition'
import { Message, type Model } from './definition'
import { storyQuery } from './query'
import type { CommentDefinition, StoryDefinition } from './types'
import { init, update } from './update'
import { view } from './view'

const urlFor = (path: string) =>
  Option.getOrThrow(Url.fromString(`http://localhost${path}`))

const reply: CommentDefinition = {
  id: 2,
  user: Option.some('dang'),
  time_ago: '1 hour ago',
  content: Option.some('<p>A reply</p>'),
  comments: [],
}

const parent: CommentDefinition = {
  id: 1,
  user: Option.some('pg'),
  time_ago: '2 hours ago',
  content: Option.some('<p>Top-level</p>'),
  comments: [reply],
}

const thread: StoryDefinition = {
  id: 9,
  points: Option.some(42),
  url: Option.some('https://example.com/post'),
  title: 'A thread',
  domain: Option.some('example.com'),
  type: 'link',
  time_ago: '3 hours ago',
  user: Option.some('pg'),
  comments_count: 2,
  comments: [parent],
}

/** The story route with its data delivered through the Binding, as the
 *  Runtime would deliver the Query's completion. */
const withThread = (): Model => {
  const opened = init(urlFor('/stories/9')).model
  return update(
    opened,
    toParentMessage(
      StoryBinding,
      storyQuery.Message.CompletedFetch({
        args: { id: '9' },
        generation: 1,
        requestKey: JSON.stringify({ id: '9' }),
        result: Result.succeed(thread),
      }),
    ),
  ).model
}

describe('story page', () => {
  test('renders the original markup and collapses a reply thread', () => {
    scene(
      { update, view },
      given(withThread()),
      expect(selector('.item-view-header h1')).toHaveText('A thread'),
      expect(selector('.item-view-comments-header')).toHaveText('2 comments'),
      // Comment bodies are InnerHTML, which Scene's virtual DOM does not
      // parse; the reply's author link proves the nested comment rendered.
      expect(role('link', { name: 'dang' })).toExist(),
      expect(selector('details.toggle')).toHaveAttr('open', 'true'),
      click(selector('details.toggle summary')),
      expect(selector('details.toggle')).not.toHaveAttr('open', 'true'),
    )
  })

  test('shows Loading before the first response', () => {
    scene(
      { update, view },
      given(init(urlFor('/stories/9')).model),
      expect(text('Loading...')).toExist(),
      expect(role('link', { name: 'HN' })).toExist(),
    )
  })
})

describe('message contract', () => {
  test('comment toggles are plain Messages', () => {
    const toggled = update(
      withThread(),
      Message.ClickedCommentToggle({ id: 1 }),
    ).model
    scene(
      { update, view },
      given(toggled),
      expect(selector('details.toggle')).not.toHaveAttr('open', 'true'),
    )
  })
})
