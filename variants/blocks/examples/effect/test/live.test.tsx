// The real Effect programs (no scripting): a search in flight is interrupted
// when Solid closes its flight, and the fiber's finalizer reports it.
import { Layer } from "effect";
import { render } from "@solidjs/web";
import { expect, test } from "vitest";
import { run, type Running } from "@solidkit/blocks";
import { settled } from "@solidkit/blocks/testing";
import { createKernel } from "@solidkit/kernel";
import { SearchConfig } from "../src/api.ts";
import { App } from "../src/app.tsx";
import { createServices } from "../src/services.ts";
import { createRuntime, RuntimeContext } from "../src/solid-effect.ts";

// Slow enough that the search is still in flight when the tab changes.
const SlowSearch = Layer.succeed(SearchConfig, { flakiness: 0, baseLatencyMs: 2000 });

test("leaving the tab interrupts the search in flight (fiber, retries and all)", async () => {
  const kernel = createKernel();
  let app!: Running<typeof App>;
  function Main() {
    app = run(App, { kernel, services: createServices() });
    return <app.View />;
  }
  const el = document.createElement("div");
  document.body.append(el);
  const dispose = render(
    () => (
      <RuntimeContext value={createRuntime(SlowSearch)}>
        <Main />
      </RuntimeContext>
    ),
    el
  );
  await settled();
  app.at("typeahead").send({ type: "ChangedQuery", query: "sol" });
  await settled();
  app.send({ type: "ClickedTab", tab: "checkout" });
  for (let i = 0; i < 50 && !app.model.log.entries.some(e => e.kind === "interrupt"); i++) await settled(2);
  expect(app.model.log.entries.map(e => `${e.kind}: ${e.message}`)).toEqual([
    'start: search "sol" — fiber started',
    'interrupt: search "sol" interrupted — fiber + pending retries torn down'
  ]);
  // Recorded on the timeline as one call with no result.
  const search = kernel.entries().filter(e => e.kind === "service" && e.path === "registry.search");
  expect(search.map(e => (e.kind === "service" ? e.phase : ""))).toEqual(["call"]);
  dispose();
  el.remove();
});
