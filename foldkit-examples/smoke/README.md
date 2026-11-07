# Browser smoke checks

The headless-Chrome scripts used to check each port against its dev server.
They use the installed Google Chrome (`channel: 'chrome'`), so Playwright does
not download a browser.

```sh
pnpm install
# in another terminal: cd ../todos && pnpm dev
node todos.mjs http://localhost:3102/
node effect.mjs http://localhost:3107/      # with ../effect running
node hn.mjs http://localhost:3105           # with ../hackernews running (needs network)
```

Each script prints a JSON summary of what it observed. The todos and effect
results depend on the APIs' random failures; hackernews depends on the live
HN APIs.
