import { Program, Runtime } from 'foldkit'

import { ApplicationBlock, crashView } from './application'
import { ApplicationLayer } from './services'

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
