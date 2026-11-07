import type { Block } from 'foldkit'

import { TodosDefinition } from './definition'

export const TodosComposition = TodosDefinition.makeComposition()
export type TodosViewBuilder = Block.ViewBuilderFor<typeof TodosComposition>
