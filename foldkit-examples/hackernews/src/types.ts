// Port of solid/examples/hackernews-spa/src/types.ts, as Schemas so the
// responses are decoded at the edge. Absent or null fields become Options.

import { type Option, Schema } from 'effect'

export const Feed = Schema.Literals(['top', 'new', 'show', 'ask', 'job'])
export type Feed = typeof Feed.Type

export interface CommentDefinition {
  readonly id: number
  /** Missing on deleted comments. */
  readonly user: Option.Option<string>
  readonly time_ago: string
  /** Missing on some dead or deleted comments. */
  readonly content: Option.Option<string>
  readonly comments: ReadonlyArray<CommentDefinition>
}

export interface CommentDefinitionEncoded {
  readonly id: number
  readonly user?: string
  readonly time_ago: string
  readonly content?: string
  readonly comments: ReadonlyArray<CommentDefinitionEncoded>
}

export const CommentDefinition: Schema.Codec<
  CommentDefinition,
  CommentDefinitionEncoded
> = Schema.Struct({
  id: Schema.Number,
  user: Schema.OptionFromOptionalKey(Schema.String),
  time_ago: Schema.String,
  content: Schema.OptionFromOptionalKey(Schema.String),
  comments: Schema.Array(
    Schema.suspend(
      (): Schema.Codec<CommentDefinition, CommentDefinitionEncoded> =>
        CommentDefinition,
    ),
  ),
})

const storyFields = {
  id: Schema.Number,
  points: Schema.OptionFromNullOr(Schema.Number),
  url: Schema.OptionFromOptionalKey(Schema.String),
  title: Schema.String,
  domain: Schema.OptionFromOptionalKey(Schema.String),
  type: Schema.String,
  time_ago: Schema.String,
  user: Schema.OptionFromNullOr(Schema.String),
  comments_count: Schema.Number,
}

/** A row of a feed (news, newest, show, ask, jobs). */
export const StorySummary = Schema.Struct(storyFields)
export type StorySummary = typeof StorySummary.Type

/** `item/:id`: the story with its comment tree. */
export const StoryDefinition = Schema.Struct({
  ...storyFields,
  comments: Schema.Array(CommentDefinition),
})
export type StoryDefinition = typeof StoryDefinition.Type

/** Firebase `user/:id.json`. `about` is HTML; `created` is a Unix time. */
export const UserDefinition = Schema.Struct({
  id: Schema.String,
  created: Schema.Number,
  karma: Schema.Number,
  about: Schema.OptionFromOptionalKey(Schema.String),
})
export type UserDefinition = typeof UserDefinition.Type

/** Firebase answers `null` for an unknown user. */
export const MaybeUser = Schema.OptionFromNullOr(UserDefinition)
