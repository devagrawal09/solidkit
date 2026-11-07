import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

export default defineConfig({
  plugins: [foldkit()],
  // The Solid original runs on 3002; this port sits beside it.
  server: { port: 3102 },
  preview: { port: 3102 },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
