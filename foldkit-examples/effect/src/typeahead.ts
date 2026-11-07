// Port of solid/examples/effect/src/typeahead.tsx: every keystroke starts a
// search; a superseded search is interrupted, not ignored.
//
// Solid consumes the Effect as an AsyncIterable and interrupts the fiber when
// the memo re-runs and closes the stale iterator. Foldkit has no implicit
// flight: the Model records which search is running, and the next keystroke
// returns `SearchPackages.Interrupt` for it alongside the new search. Each
// search has its own interrupt key (its `searchId`), so the replacement can
// start immediately without racing its own cancellation.

import { Array, Effect, Number, Option, Schema, String } from 'effect'
import { AsyncData, Block, Command } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Package, SearchConfig, searchPackages } from './api'
import { EventLog } from './eventLog'

// MODEL

export const SearchResults = AsyncData.Schema(
  Schema.Array(Package),
  Schema.String,
)

export const Model = Schema.Struct({
  query: Schema.String,
  /** Generation of the latest search; also the interrupt key of that search. */
  searchId: Schema.Number,
  maybeRunningSearchId: Schema.Option(Schema.Number),
  results: SearchResults.schema,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ChangedQuery: { query: Schema.String },
  ClickedTryAgain: {},
  SucceededSearchPackages: {
    searchId: Schema.Number,
    packages: Schema.Array(Package),
  },
  FailedSearchPackages: { searchId: Schema.Number, reason: Schema.String },
  CompletedInterruptSearchPackages: {
    searchId: Schema.Number,
    outcome: Command.Interruptible.Outcome,
  },
})

const TypeaheadDefinition = Block.makeDefinition('Typeahead', {
  Model,
  Message,
})

const { makeNoopStep } = TypeaheadDefinition

const TypeaheadComposition = TypeaheadDefinition.makeComposition()

// COMMAND

const describeSearchError = (error: Readonly<{ _tag: string }>): string =>
  error._tag === 'TransientNetwork'
    ? 'TransientNetwork (still failing after 3 retries)'
    : `${error._tag} (no answer within 4s)`

export const SearchPackages = TypeaheadDefinition.makeCommand(
  'SearchPackages',
  {
    args: { searchId: Schema.Number, query: Schema.String },
    messages: [Message.SucceededSearchPackages, Message.FailedSearchPackages],
    interrupt: {
      keyFields: ['searchId'],
      toKey: ({ searchId }) => globalThis.String(searchId),
    },
    handler: function* () {
      // The program's R channel (SearchConfig, EventLog) is satisfied once, from
      // the application Layer, when the Runtime builds this handler.
      const services = yield* Effect.context<SearchConfig | EventLog>()

      return ({ searchId, query }) =>
        searchPackages(query).pipe(
          Effect.map(packages =>
            Message.SucceededSearchPackages({ searchId, packages }),
          ),
          Effect.catch(error =>
            Effect.succeed(
              Message.FailedSearchPackages({
                searchId,
                reason: describeSearchError(error),
              }),
            ),
          ),
          Effect.provideContext(services),
        )
    },
  },
)

// UPDATE

export const init = TypeaheadComposition.makeInit(() => ({
  model: Model.make({
    query: '',
    searchId: 0,
    maybeRunningSearchId: Option.none(),
    results: SearchResults.Idle(),
  }),
}))

const interruptRunningSearch = (model: Model) =>
  Option.match(model.maybeRunningSearchId, {
    onNone: () => [],
    onSome: searchId => [
      SearchPackages.Interrupt({ searchId }, outcome =>
        Message.CompletedInterruptSearchPackages({ searchId, outcome }),
      ),
    ],
  })

/** Start a search for `query`, interrupting the one in flight. Results already
 *  on screen stay there, marked stale, until the new ones arrive. */
const startSearch = (model: Model, query: string) => {
  const searchId = Number.increment(model.searchId)
  return {
    model: modifyFields(model, {
      query: () => query,
      searchId: () => searchId,
      maybeRunningSearchId: () => Option.some(searchId),
      results: results =>
        Option.getOrElse(AsyncData.revalidateOrLoad(results), () => results),
    }),
    commands: [
      ...interruptRunningSearch(model),
      SearchPackages({ searchId, query: String.trim(query) }),
    ],
  }
}

export const update = TypeaheadComposition.makeUpdate({
  ChangedQuery: (model, { query }) => {
    if (String.isEmpty(String.trim(query))) {
      return {
        model: modifyFields(model, {
          query: () => query,
          maybeRunningSearchId: () => Option.none(),
          results: () => SearchResults.Idle(),
        }),
        commands: interruptRunningSearch(model),
      }
    }
    return startSearch(model, query)
  },

  ClickedTryAgain: model => startSearch(model, model.query),

  SucceededSearchPackages: (model, { searchId, packages }) => {
    if (searchId !== model.searchId) {
      return { model }
    }
    return {
      model: modifyFields(model, {
        maybeRunningSearchId: () => Option.none(),
        results: () => SearchResults.Success({ data: packages }),
      }),
    }
  },

  FailedSearchPackages: (model, { searchId, reason }) => {
    if (searchId !== model.searchId) {
      return { model }
    }
    return {
      model: modifyFields(model, {
        maybeRunningSearchId: () => Option.none(),
        results: () => SearchResults.Failure({ error: reason }),
      }),
    }
  },

  // The interrupted fiber's own finalizer reports the interruption to the
  // event log; the Model has nothing left to change.
  CompletedInterruptSearchPackages: makeNoopStep(),
})

// VIEW

const formatDownloads = (downloads: number): string => {
  if (downloads >= 1_000_000) {
    return `${(downloads / 1_000_000).toFixed(1)}M`
  }
  if (downloads >= 1_000) {
    return `${Math.round(downloads / 1_000)}k`
  }
  return globalThis.String(downloads)
}

type TypeaheadViewBuilder = Block.ViewBuilderFor<typeof TypeaheadComposition>

const resultsView = (
  packages: ReadonlyArray<Package>,
  query: string,
  isStale: boolean,
  h: TypeaheadViewBuilder,
): Html =>
  h.div(
    [h.Class(isStale ? 'results stale' : 'results')],
    [
      Array.isReadonlyArrayNonEmpty(packages)
        ? h.ul(
            [],
            Array.map(packages, pkg =>
              h.keyed('li')(
                pkg.name,
                [],
                [
                  h.div(
                    [],
                    [
                      h.span([h.Class('pkg-name')], [pkg.name]),
                      h.span([h.Class('pkg-desc')], [pkg.description]),
                    ],
                  ),
                  h.span(
                    [h.Class('pkg-downloads')],
                    [`${formatDownloads(pkg.downloads)}/wk`],
                  ),
                ],
              ),
            ),
          )
        : h.p(
            [h.Class('empty')],
            [isStale ? 'Searching…' : `No packages match “${query}”.`],
          ),
    ],
  )

const errorView = (reason: string, h: TypeaheadViewBuilder): Html =>
  h.div(
    [h.Class('error-box')],
    [
      h.p([], [`Search gave up after retries: ${reason}`]),
      h.button([h.OnClick(Message.ClickedTryAgain())], ['Try again']),
    ],
  )

const view = TypeaheadComposition.makeView((model, h) => {
  const query = String.trim(model.query)
  const loading = () => h.p([h.Class('loading')], ['Searching…'])

  return h.section(
    [h.Class('panel')],
    [
      h.header(
        [],
        [
          h.h2([], ['Typeahead search']),
          h.p(
            [],
            [
              'Each keystroke starts an Effect fiber (retry ×3 w/ exponential backoff, 4s timeout, ~35% transient failure rate). Superseded flights are ',
              h.em([], ['interrupted']),
              ', not ignored — the next keystroke returns ',
              h.code([], ['SearchPackages.Interrupt']),
              ' and the Runtime interrupts the fiber.',
            ],
          ),
        ],
      ),
      h.input([
        h.Type('search'),
        h.Placeholder('Search packages… (try typing “solid” quickly)'),
        h.Value(model.query),
        h.OnInput(value => Message.ChangedQuery({ query: value })),
        h.Autofocus(true),
      ]),
      String.isEmpty(query)
        ? h.empty
        : AsyncData.match(model.results, {
            onIdle: loading,
            onLoading: loading,
            onRefreshing: packages => resultsView(packages, query, true, h),
            onSuccess: packages => resultsView(packages, query, false, h),
            onFailure: reason => errorView(reason, h),
            onStale: ({ error }) => errorView(error, h),
          }),
    ],
  )
})

const prepare = () =>
  TypeaheadComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: SearchPackages.layer,
  })
export const TypeaheadBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
