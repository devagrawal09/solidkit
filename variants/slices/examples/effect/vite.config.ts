import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid()],
  resolve: { dedupe: ["solid-js", "@solidjs/web"] },
  server: { port: 3212 },
  preview: { port: 3212 }
});
