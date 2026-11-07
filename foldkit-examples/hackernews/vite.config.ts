import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

export default defineConfig({
  plugins: [foldkit()],
  // The Solid original runs on 3005; this port sits beside it.
  server: { port: 3105 },
  preview: { port: 3105 },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
