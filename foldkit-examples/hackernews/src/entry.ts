import { Program, Runtime } from 'foldkit'

import { ApplicationBlock } from './block'
import { ApplicationLayer } from './services'
import { crashView } from './view'

const program = Program.make({
  block: ApplicationBlock,
  container: document.getElementById('root'),
  routing: {
    onUrlRequest: ApplicationBlock.Message.ClickedLink,
    onUrlChange: ApplicationBlock.Message.ChangedUrl,
  },
  crash: { view: crashView },
  devTools: { dispatch: true },
})

Runtime.run(program.provide(ApplicationLayer))
