import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

export default defineConfig({
  plugins: [foldkit()],
  // The Solid original runs on 3007; this port sits beside it.
  server: { port: 3107 },
  preview: { port: 3107 },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
