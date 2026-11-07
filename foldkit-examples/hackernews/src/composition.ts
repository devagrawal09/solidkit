import type { Block } from 'foldkit'

import { ApplicationDefinition } from './definition'
import { storiesQuery, storyQuery, userQuery } from './query'

export const StoriesBinding = ApplicationDefinition.makeBinding(storiesQuery, {
  field: 'stories',
})

export const StoryBinding = ApplicationDefinition.makeBinding(storyQuery, {
  field: 'story',
})

export const UserBinding = ApplicationDefinition.makeBinding(userQuery, {
  field: 'user',
})

export const ApplicationComposition = ApplicationDefinition.makeComposition({
  bindings: [StoriesBinding, StoryBinding, UserBinding],
})
export type ApplicationViewBuilder = Block.ViewBuilderFor<
  typeof ApplicationComposition
>
