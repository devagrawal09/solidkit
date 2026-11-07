import { afterEach, describe, expect, test, vi } from "vitest";
import { scenario, settled, type Scenario } from "@solidkit/messages/testing";
import { hackernews, type Data, type Model, type Msg } from "../src/app.ts";
import { hn, nav } from "../src/hn.ts";
import type { StoryDefinition, UserDefinition } from "../src/types.ts";
import { view } from "../src/view.tsx";

type App = Scenario<Model, Msg, Data>;
let app: App | undefined;
afterEach(() => {
  app?.dispose();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

const item = (id: number, extra: Partial<StoryDefinition> = {}): StoryDefinition => ({
  id,
  points: "10",
  url: "",
  title: `Story ${id}`,
  domain: "",
  type: "link",
  time_ago: "1 hour ago",
  user: "pg",
  comments_count: 2,
  comments: [],
  ...extra
});
const feed = (n: number, from = 1) => Array.from({ length: n }, (_, i) => item(from + i));
const pg: UserDefinition = { error: "", id: "pg", created: "1160418092", karma: 157316, about: "Bug fixer." };

const start = async (url = "/", stories = feed(30)) => {
  app = scenario(hackernews, { services: { hn, nav }, flags: "http://localhost" + url, view });
  await app.script.resolve("hn.getStories", stories, ["top", 1]);
  return app;
};
const $ = (app: App, selector: string) => app.container!.querySelector<HTMLElement>(selector);
const all = (app: App, selector: string) => [...app.container!.querySelectorAll<HTMLElement>(selector)];
const link = (app: App, url: string) => all(app, "a").find(a => a.getAttribute("href") === url)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
const follow = async (app: App, url: string) => {
  click(link(app, url));
  await app.script.resolve("nav.push", undefined, [url]);
};

describe("hackernews scenarios", () => {
  test("the front page loads the top stories, with paging links", async () => {
    app = scenario(hackernews, { services: { hn, nav }, flags: "http://localhost/", view });
    await settled();
    expect($(app, ".news-list-nav")?.textContent).toBe("Loading...");
    await app.script.resolve("hn.getStories", feed(30), ["top", 1]);
    expect(all(app, ".news-item").length).toBe(30);
    expect($(app, ".news-list-nav span:nth-child(2)")?.textContent).toBe("page 1");
    expect($(app, ".page-link.disabled")?.textContent).toBe("< prev");
    expect(link(app, "/top?page=2").textContent).toBe("more >");
  });

  test("a link click: the URL follows, and the current page stays up until the next one loads", async () => {
    const app = await start();
    await follow(app, "/stories/1");
    await app.script.expectCall("hn.getStory", ["1"]);
    expect(all(app, ".news-item").length).toBe(30); // held: no fallback, the list is still there
    expect($(app, ".item-view")).toBeNull();
    const comment = { id: 9, user: "dang", time_ago: "now", content: "<p>hi</p>", comments: [] };
    await app.script.resolve("hn.getStory", item(1, { comments: [comment] }), ["1"]);
    expect($(app, ".item-view h1")?.textContent).toBe("Story 1");
    expect($(app, ".item-view-comments-header")?.textContent).toBe("2 comments");
    expect($(app, ".comment .text")?.innerHTML).toBe("<p>hi</p>");
  });

  test("paging fetches the next page of the same feed", async () => {
    const app = await start();
    await follow(app, "/top?page=2");
    await app.script.resolve("hn.getStories", feed(10, 31), ["top", 2]);
    expect($(app, ".news-list-nav span:nth-child(2)")?.textContent).toBe("page 2");
    expect(link(app, "/top?page=1").textContent).toBe("< prev");
    expect($(app, ".news-list-nav .disabled")?.textContent).toBe("more >"); // fewer than 29
  });

  test("back/forward re-derives the page; a page still in the cache needs no request", async () => {
    const app = await start();
    await follow(app, "/stories/1");
    await app.script.resolve("hn.getStory", item(1), ["1"]);
    history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settled();
    app.script.expectNoCalls();
    expect(all(app, ".news-item").length).toBe(30);
    expect(app.kernel.entries().filter(e => e.kind === "transition").map(e => e.kind === "transition" && e.name)).toEqual([
      "ClickedLink",
      "ChangedUrl"
    ]);
  });

  test("intent on a link preloads it, so following it makes no new request", async () => {
    const app = await start();
    link(app, "/users/pg").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await app.script.resolve("hn.getUser", pg, ["pg"]); // the preload
    await follow(app, "/users/pg");
    app.script.expectNoCalls();
    expect($(app, ".user-view h1")?.textContent).toBe("User : pg");
    expect($(app, ".about")?.textContent).toBe("Bug fixer.");
    const acts = app.kernel.entries().flatMap(e => (e.kind === "action" ? [`${e.name} ${e.phase}`] : []));
    expect(acts).toEqual(["preload start", "preload settled", "pushUrl start", "pushUrl settled"]);
  });

  test("time travel: rewinding replays the recorded responses, with no live calls", async () => {
    const app = await start();
    const front = app.kernel.entries().at(-1)!.seq;
    await follow(app, "/stories/1");
    await app.script.resolve("hn.getStory", item(1), ["1"]);
    await follow(app, "/users/pg");
    await app.script.resolve("hn.getUser", pg, ["pg"]);
    const story = app.kernel.entries().find(e => e.kind === "service" && e.path === "hn.getStory" && e.phase === "result")!.seq;

    // past the request cache's lifetime, so the pages come from the kernel's replay
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    app.kernel.rewind(front);
    await settled();
    app.script.expectNoCalls();
    expect(all(app, ".news-item").length).toBe(30);
    expect(app.kernel.entries().some(e => e.kind === "service" && e.replayed && e.path === "hn.getStories")).toBe(true);

    app.kernel.rewind(story);
    await settled();
    app.script.expectNoCalls();
    expect($(app, ".item-view h1")?.textContent).toBe("Story 1");

    app.kernel.resume();
    await app.script.resolve("hn.getUser", pg, ["pg"]); // live again: the head refetches
    expect($(app, ".user-view h1")?.textContent).toBe("User : pg");
  });
});
