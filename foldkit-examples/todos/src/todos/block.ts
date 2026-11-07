import { Block } from 'foldkit'

import { EffectsLayer } from './command'
import { TodosComposition } from './composition'
import { Message, type Model } from './definition'
import { init, update } from './update'
import { view } from './view'

const prepare = () =>
  TodosComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer,
    operations: {
      requestAddTodo: Message.RequestedAddTodo,
    },
  })
export const TodosBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
