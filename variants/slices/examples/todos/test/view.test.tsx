// The view against scripted services: loading, rows, the error boundary, and the hash filter.
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { afterEach, describe, expect, test } from "vitest";
import { scripted, settled } from "@solidkit/slices/testing";
import { api } from "../src/api";
import { App } from "../src/app";
import { Todos } from "../src/todos";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  history.replaceState(null, "", "#/");
});

function mount() {
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const el = document.body.appendChild(document.createElement("div"));
  dispose = render(() => {
    const todos = Todos.create(kernel, api, location.hash);
    return <App todos={todos} />;
  }, el);
  flush();
  return { kernel, script, el };
}

const labels = (el: HTMLElement) => [...el.querySelectorAll(".todo-list li")].map(li => `${li.className}|${li.textContent}`);

describe("todos view", () => {
  test("shows Loading, then the list, the count and the per-item retry", async () => {
    const { script, el } = mount();
    expect(el.querySelector(".loading")?.textContent).toBe("Loading…");
    await script.resolve("api.getTodos", [
      { id: "1", title: "Write the RFC", completed: false },
      { id: "2", title: "Ship it", completed: true }
    ]);
    expect(labels(el)).toEqual(["todo|Write the RFC", "todo completed|Ship it"]);
    expect(el.querySelector(".todo-count")?.textContent).toBe("1 item left");

    (el.querySelector(".toggle") as HTMLInputElement).click();
    await settled();
    expect(labels(el)[0]).toBe("todo completed pending|Write the RFC");
    await script.reject("api.toggleTodo", "Failed to Save");
    await script.resolve("api.getTodos", [
      { id: "1", title: "Write the RFC", completed: false },
      { id: "2", title: "Ship it", completed: true }
    ]);
    expect(labels(el)[0]).toBe("todo errored|Write the RFC");
    expect(el.querySelector(".retry")?.getAttribute("title")).toBe("Retry toggleTodo");
  });

  test("the hash filters the list", async () => {
    const { script, el } = mount();
    await script.resolve("api.getTodos", [
      { id: "1", title: "Write the RFC", completed: false },
      { id: "2", title: "Ship it", completed: true }
    ]);
    location.hash = "#/completed";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settled();
    expect(labels(el)).toEqual(["todo completed|Ship it"]);
    expect(el.querySelector(".filters .selected")?.textContent?.trim()).toBe("Completed");
  });

  test("a failed load lands in the error boundary; Reset asks again", async () => {
    const { script, el } = mount();
    await script.reject("api.getTodos", new Error("offline"));
    expect(el.querySelector(".app-error p")?.textContent).toBe("Something went wrong: Error: offline");
    (el.querySelector(".app-error button") as HTMLButtonElement).click();
    await script.expectCall("api.getTodos");
    await script.resolve("api.getTodos", [{ id: "1", title: "Write the RFC", completed: false }]);
    expect(el.querySelector(".app-error")).toBeNull();
    expect(labels(el)).toEqual(["todo|Write the RFC"]);
  });
});
