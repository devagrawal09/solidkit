// The view against scripted services: typeahead loading, results, the
// search error boundary with retry, tabs, orders and the log panel.
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { afterEach, describe, expect, test } from "vitest";
import { scripted, settled } from "@solidkit/slices/testing";
import { SearchConfigLive } from "../src/api";
import { App } from "../src/app";
import { log } from "../src/log";
import { Shop } from "../src/shop";

const SIGNAL = JSON.parse(JSON.stringify(new AbortController().signal));
let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});

async function mount() {
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const el = document.body.appendChild(document.createElement("div"));
  dispose = render(() => {
    const shop = Shop.create(kernel, SearchConfigLive);
    return <App shop={shop} />;
  }, el);
  flush();
  await script.resolve("backend.fetchOrders", []);
  return { kernel, script, el };
}

function type(el: HTMLElement, text: string) {
  const input = el.querySelector("input[type=search]") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

describe("effect view", () => {
  test("typeahead: Searching…, then results", async () => {
    const { script, el } = await mount();
    type(el, "solid");
    await script.expectCall("backend.searchPackages", ["solid", SIGNAL]);
    // The memo answered [] for the empty query, so the stale list stays and isPending says so.
    expect(el.querySelector(".results.stale .empty")?.textContent).toBe("Searching…");
    await script.resolve("backend.searchPackages", [{ name: "solid-js", description: "Fine-grained", downloads: 1_450_000 }]);
    expect([...el.querySelectorAll(".results li")].map(li => li.textContent)).toEqual(["solid-jsFine-grained1.4M/wk"]);
  });

  test("a search that gives up lands in its error boundary; Try again asks again", async () => {
    const { script, el } = await mount();
    type(el, "zzz");
    await script.expectCall("backend.searchPackages", ["zzz", SIGNAL]);
    await script.reject("backend.searchPackages", new Error("TimeoutException"));
    expect(el.querySelector(".error-box p")?.textContent).toBe("Search gave up after retries: Error: TimeoutException");
    (el.querySelector(".error-box button") as HTMLButtonElement).click();
    await script.expectCall("backend.searchPackages", ["zzz", SIGNAL]);
    await script.resolve("backend.searchPackages", []);
    expect(el.querySelector(".error-box")).toBeNull();
    expect(el.querySelector(".results .empty")?.textContent).toBe("No packages match “zzz”.");
  });

  test("tabs switch to the checkout; the log panel shows what log() wrote", async () => {
    const { el } = await mount();
    const [, checkoutTab] = el.querySelectorAll(".tabs button");
    (checkoutTab as HTMLButtonElement).click();
    await settled();
    expect(el.querySelector(".panel h2")?.textContent).toBe("Checkout saga");
    expect(el.querySelector(".orders, .empty")?.textContent).toBe("No orders yet.");
    log("start", "reserveInventory — placing hold");
    await settled();
    expect(el.querySelector(".log-panel .log-msg")?.textContent).toBe("reserveInventory — placing hold");
    (el.querySelector(".log-panel header button") as HTMLButtonElement).click();
    await settled();
    expect(el.querySelector(".log-panel .empty")?.textContent).toBe("Interact to see fiber lifecycle events.");
  });
});