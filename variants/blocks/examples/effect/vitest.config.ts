import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["browser", "development"], dedupe: ["solid-js", "@solidjs/web"] },
  test: { environment: "happy-dom", server: { deps: { inline: [/solid-js/, /@solidjs\//] } } }
});
