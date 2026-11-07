// Scenario tests: the real blocks, data and actions, against scripted services.
import { describe, expect, test } from "vitest";
import { liveCalls, settled, start, transitions } from "@solidkit/blocks/testing";
import { api, type Todo } from "../src/api.ts";
import { App } from "../src/app.tsx";

// Ids sort before Date.now()-based ones, as todos made earlier would.
const A: Todo = { id: "1-a", title: "Write the RFC", completed: false };
const B: Todo = { id: "1-b", title: "Ship it", completed: true };
const C: Todo = { id: "1-c", title: "Third", completed: false };

async function boot(todos: Todo[] = [A, B], hash = "#/") {
  const t = start(App, { services: { api }, args: { hash }, render: true });
  await t.script.expectCall("api.getTodos");
  expect(t.container.textContent).toContain("Loading…");
  await t.script.resolve("api.getTodos", todos);
  return t;
}

type T = Awaited<ReturnType<typeof boot>>;
const q = <E extends Element>(t: T, selector: string) => t.container.querySelector<E>(selector)!;
const rows = (t: T) =>
  [...t.container.querySelectorAll(".todo-list li")].map(li => {
    const retry = li.querySelector(".retry")?.getAttribute("title");
    const state = ["completed", "pending", "errored"].filter(c => li.classList.contains(c));
    return [li.querySelector("label")!.textContent, ...state, ...(retry ? [retry] : [])].join(" ");
  });
const row = (t: T, title: string) => [...t.container.querySelectorAll(".todo-list li")].find(li => li.textContent === title)!;

async function type(t: T, text: string) {
  const input = q<HTMLInputElement>(t, ".new-todo");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settled(); // each keystroke is its own task in a browser
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settled();
}
async function toggle(el: Element) {
  const box = el as HTMLInputElement;
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await settled();
}
async function click(el: Element) {
  (el as HTMLElement).click();
  await settled();
}

describe("todos", () => {
  test("loads, then shows the list, remaining count and filters", async () => {
    const t = await boot();
    expect(rows(t)).toEqual(["Write the RFC", "Ship it completed"]);
    expect(q(t, ".todo-count").textContent).toBe("1 item left");
    expect(q(t, ".clear-completed")).toBeTruthy();
    t.dispose();
  });

  test("an add shows at once as pending, then settles to server truth", async () => {
    const t = await boot([A]);
    await type(t, "  Buy milk ");
    expect(rows(t)).toEqual(["Write the RFC", "Buy milk pending"]);
    expect(q<HTMLInputElement>(t, ".new-todo").value).toBe("");
    const call = t.script.pending()[0];
    expect(call.path).toBe("api.addTodo");
    const added = call.args[0] as Todo;
    await t.script.resolve("api.addTodo", added);
    await t.script.expectCall("api.getTodos");
    await t.script.resolve("api.getTodos", [A, added]);
    expect(rows(t)).toEqual(["Write the RFC", "Buy milk"]);
    expect(transitions(t.kernel)).toEqual([
      "todos · init",
      "todos/header · ChangedText",
      "todos/header · Submitted",
      "todos · header.EnteredTitle",
      "todos/list · RequestedAdd",
      "todos/list · Saved"
    ]);
    t.dispose();
  });

  test("a failed add stays visible with a retry, and the retry can succeed", async () => {
    const t = await boot([A]);
    await type(t, "Buy milk");
    const added = t.script.pending()[0].args[0] as Todo;
    await t.script.reject("api.addTodo", "Failed to Save");
    await t.script.resolve("api.getTodos", [A]);
    expect(rows(t)).toEqual(["Write the RFC", "Buy milk errored Retry addTodo"]);

    await click(row(t, "Buy milk").querySelector(".retry")!);
    expect(rows(t)).toEqual(["Write the RFC", "Buy milk pending errored Retry addTodo"]);
    await t.script.resolve("api.addTodo", added);
    await t.script.resolve("api.getTodos", [A, added]);
    expect(rows(t)).toEqual(["Write the RFC", "Buy milk"]);
    t.dispose();
  });

  test("a failed toggle reverts and offers its own retry", async () => {
    const t = await boot();
    await toggle(row(t, "Write the RFC").querySelector(".toggle")!);
    expect(rows(t)[0]).toBe("Write the RFC completed pending");
    await t.script.reject("api.toggleTodo", "Failed to Save");
    await t.script.resolve("api.getTodos", [A, B]);
    expect(rows(t)).toEqual(["Write the RFC errored Retry toggleTodo", "Ship it completed"]);
    t.dispose();
  });

  test("toggle-all and clear-completed failures fan out to per-item retries", async () => {
    const t = await boot([A, C, B]);
    await toggle(q(t, ".toggle-all"));
    expect(rows(t)).toEqual(["Write the RFC completed pending", "Third completed pending", "Ship it completed"]);
    await t.script.reject("api.toggleAll", "Failed to Save");
    await t.script.resolve("api.getTodos", [A, C, B]);
    expect(rows(t)).toEqual(["Write the RFC errored Retry toggleTodo", "Third errored Retry toggleTodo", "Ship it completed"]);

    await click(q(t, ".clear-completed"));
    expect(rows(t)).toEqual(["Write the RFC errored Retry toggleTodo", "Third errored Retry toggleTodo"]);
    await t.script.reject("api.clearCompleted", "Failed to Save");
    await t.script.resolve("api.getTodos", [A, C, B]);
    expect(rows(t)[2]).toBe("Ship it completed errored Retry removeTodo");
    t.dispose();
  });

  test("the hash filters the list", async () => {
    const t = await boot();
    location.hash = "#/active";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settled();
    expect(rows(t)).toEqual(["Write the RFC"]);
    expect(q(t, ".filters .selected").textContent).toBe("Active");
    location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settled();
    expect(rows(t)).toHaveLength(2);
    t.dispose();
  });

  test("time travel: rewinding before a failed toggle shows the app as it was, with no network", async () => {
    const t = await boot();
    await toggle(row(t, "Write the RFC").querySelector(".toggle")!);
    await t.script.reject("api.toggleTodo", "Failed to Save");
    await t.script.resolve("api.getTodos", [A, B]);
    expect(rows(t)[0]).toBe("Write the RFC errored Retry toggleTodo");
    const calls = liveCalls(t.kernel).length;

    const toggled = t.kernel.entries().find(e => e.kind === "transition" && e.name === "ToggledTodo")!;
    t.kernel.rewind(toggled.seq - 1);
    await settled();
    expect(rows(t)).toEqual(["Write the RFC", "Ship it completed"]);
    expect(t.app.at("list").state()).toEqual({ filter: "all", failures: {} });
    t.script.expectNoCalls();
    expect(liveCalls(t.kernel)).toHaveLength(calls);

    // Clicks are ignored while rewound.
    await toggle(row(t, "Write the RFC").querySelector(".toggle")!);
    t.script.expectNoCalls();

    // The failure entry itself shows the failure.
    const failedAt = t.kernel.entries().find(e => e.kind === "transition" && e.name === "SaveFailed")!;
    t.kernel.rewind(failedAt.seq);
    await settled();
    expect(rows(t)[0]).toBe("Write the RFC errored Retry toggleTodo");

    t.kernel.resume();
    await t.script.expectCall("api.getTodos");
    await t.script.resolve("api.getTodos", [A, B]);
    expect(rows(t)[0]).toBe("Write the RFC errored Retry toggleTodo");
    t.dispose();
  });
});
