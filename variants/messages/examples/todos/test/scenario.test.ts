import { flush } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { scenario, settled, type Scenario } from "@solidkit/messages/testing";
import { api, type Todo } from "../src/api.ts";
import { Msg, todos, type Data, type Model } from "../src/todos.ts";
import { view } from "../src/view.tsx";

type App = Scenario<Model, Msg, Data>;
let app: App | undefined;
afterEach(() => app?.dispose());

const start = async (initial: Todo[], hash = "#/") => {
  app = scenario(todos, { services: { api }, flags: hash, view });
  await app.script.resolve("api.getTodos", initial);
  return app;
};
const $ = (app: App, selector: string) => app.container!.querySelector<HTMLElement>(selector);
const rows = (app: App) =>
  [...app.container!.querySelectorAll<HTMLLIElement>(".todo-list li")].map(li => {
    const flags = ["completed", "pending", "errored"].filter(c => li.classList.contains(c));
    return [li.querySelector("label")!.textContent, ...flags].join(" ");
  });
const count = (app: App) => $(app, ".todo-count")?.textContent;
const type = (app: App, text: string) => {
  const input = $(app, ".new-todo") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flush(); // typing and Enter are separate tasks in a browser, with a flush between
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};
const click = (el: HTMLElement | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const toggle = (app: App, title: string) => {
  const li = [...app.container!.querySelectorAll(".todo-list li")].find(li => li.querySelector("label")!.textContent === title)!;
  const box = li.querySelector<HTMLInputElement>(".toggle")!;
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};
const button = (app: App, title: string, selector: string) => {
  const li = [...app.container!.querySelectorAll(".todo-list li")].find(li => li.querySelector("label")!.textContent === title)!;
  return li.querySelector<HTMLElement>(selector);
};

const rfc: Todo = { id: "1", title: "Write the RFC", completed: false };
const ship: Todo = { id: "2", title: "Ship it", completed: true };

describe("todos scenarios", () => {
  test("loading, then the list with a remaining count", async () => {
    app = scenario(todos, { services: { api }, flags: "#/", view });
    await settled();
    expect($(app, ".loading")?.textContent).toBe("Loading…");
    await app.script.resolve("api.getTodos", [rfc, ship]);
    expect(rows(app)).toEqual(["Write the RFC", "Ship it completed"]);
    expect(count(app)).toBe("1 item left");
  });

  test("an add shows at once as pending, the draft clears, and the save settles it", async () => {
    const app = await start([rfc]);
    type(app, "Buy milk");
    await app.script.expectCall("api.addTodo");
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk pending"]);
    expect(($(app, ".new-todo") as HTMLInputElement).value).toBe("");
    const added = (app.script.pending()[0].args[0] as Todo);
    await app.script.resolve("api.addTodo", added);
    await app.script.resolve("api.getTodos", [rfc, added]);
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk"]);
    expect(count(app)).toBe("2 items left");
  });

  test("a failed add stays visible with a retry, and the retry can succeed", async () => {
    const app = await start([rfc]);
    type(app, "Buy milk");
    await app.script.reject("api.addTodo", "Failed to Save");
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk errored"]);
    expect(button(app, "Buy milk", ".retry")?.title).toBe("Retry addTodo");

    click(button(app, "Buy milk", ".retry"));
    await app.script.expectCall("api.addTodo");
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk pending errored"]); // still marked until saved
    const added = app.script.pending()[0].args[0] as Todo;
    await app.script.resolve("api.addTodo", added);
    await app.script.resolve("api.getTodos", [rfc, added]);
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk"]);
  });

  test("a failed toggle reverts and offers a retry of that toggle", async () => {
    const app = await start([rfc]);
    toggle(app, "Write the RFC");
    await app.script.expectCall("api.toggleTodo", ["1", true]);
    expect(rows(app)).toEqual(["Write the RFC completed pending"]);
    await app.script.reject("api.toggleTodo", "Failed to Save");
    expect(rows(app)).toEqual(["Write the RFC errored"]);
    expect(button(app, "Write the RFC", ".retry")?.title).toBe("Retry toggleTodo");
    click(button(app, "Write the RFC", ".retry"));
    await app.script.resolve("api.toggleTodo", { ...rfc, completed: true }, ["1", true]);
    await app.script.resolve("api.getTodos", [{ ...rfc, completed: true }]);
    expect(rows(app)).toEqual(["Write the RFC completed"]);
  });

  test("a failed toggle-all fans out to a retry on every item it touched", async () => {
    const third: Todo = { id: "3", title: "Celebrate", completed: false };
    const app = await start([rfc, ship, third]);
    click($(app, ".toggle-all"));
    await app.script.expectCall("api.toggleAll", [["1", "3"], true]);
    expect(rows(app)).toEqual(["Write the RFC completed pending", "Ship it completed", "Celebrate completed pending"]);
    await app.script.reject("api.toggleAll", "Failed to Save");
    expect(rows(app)).toEqual(["Write the RFC errored", "Ship it completed", "Celebrate errored"]);
    expect(button(app, "Celebrate", ".retry")?.title).toBe("Retry toggleTodo");
  });

  test("a failed clear-completed brings the items back, each with a retry", async () => {
    const app = await start([rfc, ship]);
    click($(app, ".clear-completed"));
    await app.script.expectCall("api.clearCompleted", [["2"]]);
    expect(rows(app)).toEqual(["Write the RFC"]);
    await app.script.reject("api.clearCompleted", "Failed to Save");
    expect(rows(app)).toEqual(["Write the RFC", "Ship it completed errored"]);
    expect(button(app, "Ship it", ".retry")?.title).toBe("Retry removeTodo");
  });

  test("the hash filter follows hashchange", async () => {
    const app = await start([rfc, ship], "#/active");
    expect(rows(app)).toEqual(["Write the RFC"]);
    location.hash = "#/completed";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settled();
    expect(rows(app)).toEqual(["Ship it completed"]);
    expect($(app, ".filters .selected")?.textContent?.trim()).toBe("Completed");
    location.hash = "";
  });

  test("time travel: rewinding shows the list as it was, with no live calls; resume returns", async () => {
    const app = await start([rfc]);
    const beforeAdd = app.kernel.entries().at(-1)!.seq;
    type(app, "Buy milk");
    const added = (await app.script.expectCall("api.addTodo"), app.script.pending()[0].args[0] as Todo);
    await app.script.resolve("api.addTodo", added);
    await app.script.resolve("api.getTodos", [rfc, added]);
    toggle(app, "Buy milk");
    await app.script.reject("api.toggleTodo", "Failed to Save");
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk errored"]);

    app.kernel.rewind(beforeAdd);
    await settled();
    app.script.expectNoCalls();
    expect(rows(app)).toEqual(["Write the RFC"]);
    expect(app.model.failures).toEqual({});
    expect(app.container!.firstElementChild!.hasAttribute("inert")).toBe(true);

    // the draft as it was typed (each keystroke is a transition)
    const typed = app.kernel.entries().find(e => e.kind === "transition" && e.name === "UpdatedDraft")!;
    app.kernel.rewind(typed.seq);
    await settled();
    expect(($(app, ".new-todo") as HTMLInputElement).value).toBe("Buy milk");
    app.script.expectNoCalls();

    // input is dropped while rewound
    app.send(Msg.ClickedDestroy({ id: "1" }));
    await settled();
    app.script.expectNoCalls();

    app.kernel.resume();
    await app.script.resolve("api.getTodos", [rfc, added]);
    expect(rows(app)).toEqual(["Write the RFC", "Buy milk errored"]);
    expect(app.container!.firstElementChild!.hasAttribute("inert")).toBe(false);
  });

  test("a failed load shows the error boundary; Reset tries again", async () => {
    app = scenario(todos, { services: { api }, flags: "#/", view });
    await app.script.reject("api.getTodos", new Error("offline"));
    expect($(app, ".app-error p")?.textContent).toBe("Something went wrong: Error: offline");
    click($(app, ".app-error button"));
    await app.script.resolve("api.getTodos", [rfc]);
    expect(rows(app)).toEqual(["Write the RFC"]);
  });
});
