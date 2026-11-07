// Port of solid/examples/hackernews-spa/src/server/hn.ts.
//
// The original runs on the server ("use server" functions) and the browser
// only sees JSON. Foldkit has no server-function layer, so this Service calls
// the public APIs from the browser:
//
//   - node-hnapi.herokuapp.com sends `Access-Control-Allow-Origin: *`, and
//     hacker-news.firebaseio.com echoes the Origin, so plain GETs work. The
//     client is Foldkit's `Http.layer`, which turns off trace-header
//     propagation so requests stay CORS-simple (no preflight).
//   - node-hnapi runs on a Heroku dyno that sometimes answers 503 while it
//     wakes up, so transient failures (network errors, 5xx) are retried with
//     backoff before the error reaches the Model.
//   - The original's `User-Agent: chrome` header is dropped; browsers do not
//     let fetch set it.
//
// Story 30186326 (1,406 comments, 14 levels) is served from the original's
// capture, copied to public/ so it is fetched as a static file instead of
// being bundled, keeping the big thread deterministic as in the original.

import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
} from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import {
  type Feed,
  MaybeUser,
  StoryDefinition,
  StorySummary,
  type UserDefinition,
} from './types'

const STORY_API = 'https://node-hnapi.herokuapp.com'
const USER_API = 'https://hacker-news.firebaseio.com/v0'
const CACHED_STORY_ID = '30186326'
const CACHED_STORY_URL = '/story-30186326.json'

const FEED_PATHS: Readonly<Record<Feed, string>> = {
  top: 'news',
  new: 'newest',
  show: 'show',
  ask: 'ask',
  job: 'jobs',
}

export class HnApi extends Context.Service<
  HnApi,
  Readonly<{
    getStories: (
      feed: Feed,
      page: number,
    ) => Effect.Effect<ReadonlyArray<StorySummary>, string>
    getStory: (id: string) => Effect.Effect<StoryDefinition, string>
    getUser: (
      id: string,
    ) => Effect.Effect<Option.Option<UserDefinition>, string>
  }>
>()('HnApi') {}

const isTransient = (error: unknown): boolean =>
  !(
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    typeof error.response.status === 'number' &&
    error.response.status < 500
  )

export const HnApiLayer = Layer.effect(
  HnApi,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const getJson = <A, I>(url: string, schema: Schema.Codec<A, I>) =>
      client.execute(HttpClientRequest.get(url)).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(response => response.json),
        Effect.retry({
          schedule: Schedule.exponential(Duration.millis(300)),
          times: 2,
          while: isTransient,
        }),
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.mapError(error => `Could not load ${url}: ${String(error)}`),
      )

    return {
      getStories: (feed, page) =>
        getJson(
          `${STORY_API}/${FEED_PATHS[feed]}?page=${page}`,
          Schema.Array(StorySummary),
        ),
      getStory: id =>
        getJson(
          id === CACHED_STORY_ID ? CACHED_STORY_URL : `${STORY_API}/item/${id}`,
          StoryDefinition,
        ),
      getUser: id => getJson(`${USER_API}/user/${id}.json`, MaybeUser),
    }
  }),
)
