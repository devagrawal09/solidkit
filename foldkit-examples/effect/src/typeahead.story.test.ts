import { Interruptible } from 'foldkit/command'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import type { Package } from './api'
import {
  Message,
  SearchPackages,
  SearchResults,
  init,
  update,
} from './typeahead'

const solidJs: Package = {
  name: 'solid-js',
  description: 'Fine-grained reactive UI library',
  downloads: 1_450_000,
}
const solidRouter: Package = {
  name: '@solidjs/router',
  description: 'Universal router for Solid',
  downloads: 640_000,
}

const interruptSearch = (searchId: number) =>
  SearchPackages.Interrupt({ searchId }, outcome =>
    Message.CompletedInterruptSearchPackages({ searchId, outcome }),
  )

describe('typeahead', () => {
  test('every keystroke starts a search and interrupts the one it supersedes', () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedQuery({ query: 's' })),
      Command.expectExact(SearchPackages({ searchId: 1, query: 's' })),
      message(Message.ChangedQuery({ query: 'so' })),
      // The old search is still pending; the keystroke adds its Interrupt and
      // the replacement search, under different keys.
      Command.expectHas(interruptSearch(1)),
      Command.expectHas(SearchPackages({ searchId: 2, query: 'so' })),
      Command.resolve(
        interruptSearch(1),
        Message.CompletedInterruptSearchPackages({
          searchId: 1,
          outcome: Interruptible.Outcome.Interrupted(),
        }),
      ),
      // An interrupted search never delivers its result.
      Command.expectExact(SearchPackages({ searchId: 2, query: 'so' })),
      Command.resolve(
        SearchPackages({ searchId: 2, query: 'so' }),
        Message.SucceededSearchPackages({ searchId: 2, packages: [solidJs] }),
      ),
      model(current => {
        expect(current.results).toEqual(
          SearchResults.Success({ data: [solidJs] }),
        )
      }),
    )
  })

  test('a result that beat its Interrupt is discarded', () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedQuery({ query: 'so' })),
      message(Message.ChangedQuery({ query: 'sol' })),
      Command.resolve(
        SearchPackages({ searchId: 1, query: 'so' }),
        Message.SucceededSearchPackages({
          searchId: 1,
          packages: [solidRouter],
        }),
      ),
      Command.resolve(
        interruptSearch(1),
        Message.CompletedInterruptSearchPackages({
          searchId: 1,
          outcome: Interruptible.Outcome.NotFound(),
        }),
      ),
      model(current => {
        expect(current.results).toEqual(SearchResults.Loading())
      }),
      Command.resolve(
        SearchPackages({ searchId: 2, query: 'sol' }),
        Message.SucceededSearchPackages({ searchId: 2, packages: [solidJs] }),
      ),
      model(current => {
        expect(current.results).toEqual(
          SearchResults.Success({ data: [solidJs] }),
        )
      }),
    )
  })

  test('results stay on screen, marked stale, while the next search runs', () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedQuery({ query: 'solid' })),
      Command.resolve(
        SearchPackages({ searchId: 1, query: 'solid' }),
        Message.SucceededSearchPackages({
          searchId: 1,
          packages: [solidJs, solidRouter],
        }),
      ),
      message(Message.ChangedQuery({ query: 'solid-' })),
      model(current => {
        expect(current.results).toEqual(
          SearchResults.Refreshing({ data: [solidJs, solidRouter] }),
        )
      }),
      Command.resolve(
        SearchPackages({ searchId: 2, query: 'solid-' }),
        Message.SucceededSearchPackages({ searchId: 2, packages: [solidJs] }),
      ),
    )
  })

  test('a search that gives up shows the error; Try again searches again', () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedQuery({ query: 'vite' })),
      Command.resolve(
        SearchPackages({ searchId: 1, query: 'vite' }),
        Message.FailedSearchPackages({
          searchId: 1,
          reason: 'TransientNetwork',
        }),
      ),
      model(current => {
        expect(current.results).toEqual(
          SearchResults.Failure({ error: 'TransientNetwork' }),
        )
      }),
      message(Message.ClickedTryAgain()),
      Command.expectExact(SearchPackages({ searchId: 2, query: 'vite' })),
      Command.resolve(
        SearchPackages({ searchId: 2, query: 'vite' }),
        Message.SucceededSearchPackages({ searchId: 2, packages: [] }),
      ),
    )
  })

  test('clearing the query interrupts the running search', () => {
    story(
      update,
      given(init().model),
      message(Message.ChangedQuery({ query: 'eff' })),
      message(Message.ChangedQuery({ query: '  ' })),
      Command.resolve(
        interruptSearch(1),
        Message.CompletedInterruptSearchPackages({
          searchId: 1,
          outcome: Interruptible.Outcome.Interrupted(),
        }),
      ),
      Command.expectNone(),
      model(current => {
        expect(current.results).toEqual(SearchResults.Idle())
      }),
    )
  })
})
