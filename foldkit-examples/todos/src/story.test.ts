import { Option } from 'effect'
import { Url } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { Message, init, update } from './application'
import { urlToFilter } from './filter'

const urlFor = (href: string) => Option.getOrThrow(Url.fromString(href))

describe('hash routing', () => {
  test('hash URLs map to filters', () => {
    expect(urlToFilter(urlFor('http://localhost/#/active'))).toBe('Active')
    expect(urlToFilter(urlFor('http://localhost/#/completed'))).toBe(
      'Completed',
    )
    expect(urlToFilter(urlFor('http://localhost/#/other'))).toBe('All')
    expect(urlToFilter(urlFor('http://localhost/'))).toBe('All')
  })

  test('the initial URL seeds the filter', () => {
    expect(init(urlFor('http://localhost/#/completed')).model.filter).toBe(
      'Completed',
    )
  })

  test('a URL change updates the filter', () => {
    story(
      update,
      given(init(urlFor('http://localhost/')).model),
      message(Message.ChangedUrl({ url: urlFor('http://localhost/#/active') })),
      model(current => {
        expect(current.filter).toBe('Active')
      }),
    )
  })
})
