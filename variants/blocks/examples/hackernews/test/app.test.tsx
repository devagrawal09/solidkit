// Scenario tests: the shell and page blocks against scripted services.
import { describe, expect, onTestFinished, test } from "vitest";
import { liveCalls, settled, start, transitions } from "@solidkit/blocks/testing";
import { hn } from "../src/hn.ts";
import { Shell } from "../src/shell.tsx";
import type { CommentDefinition, StoryDefinition } from "../src/types.ts";

const story = (id: number, extra: Partial<StoryDefinition> = {}): StoryDefinition => ({
  id,
  points: "10",
  url: "",
  title: `Story ${id}`,
  domain: "",
  type: "link",
  time_ago: "1 hour ago",
  user: "pg",
  comments_count: 0,
  comments: [],
  ...extra
});
const feed = (from: number, n = 30) => Array.from({ length: n }, (_, i) => story(from + i));
const comment = (id: number, comments: CommentDefinition[] = []): CommentDefinition => ({
  id,
  user: "dang",
  time_ago: "1 hour ago",
  content: `<p>comment ${id}</p>`,
  comments
});

async function boot(path = "/", keep?: number) {
  history.replaceState(null, "", path);
  const t = start(Shell, { services: { hn }, args: { href: path, keep }, render: true });
  onTestFinished(() => t.dispose()); // even on failure: a live app keeps its document listeners
  return t;
}
type T = Awaited<ReturnType<typeof boot>>;
const $ = (t: T, selector: string) => t.container.querySelector<HTMLElement>(selector);
const titles = (t: T) => [...t.container.querySelectorAll(".news-item .title a")].map(a => a.textContent);
async function click(el: HTMLElement | null) {
  el!.click();
  await settled();
}

describe("hackernews", () => {
  test("loads a feed, then keeps it on screen while the next page loads", async () => {
    const t = await boot("/");
    await t.script.expectCall("hn.getStories", ["top", 1]);
    expect(t.container.textContent).toContain("Loading...");
    await t.script.resolve("hn.getStories", feed(1), ["top", 1]);
    expect(titles(t)).toHaveLength(30);
    expect($(t, ".news-list-nav > span:not(.page-link)")?.textContent).toBe("page 1");

    await click($(t, 'a[aria-label="Next Page"]'));
    await t.script.expectCall("hn.getStories", ["top", 2]);
    expect(location.pathname + location.search).toBe("/top?page=2");
    expect(titles(t)[0]).toBe("Story 1"); // the current page stays up, no fallback
    expect(t.container.textContent).not.toContain("Loading...");
    await t.script.resolve("hn.getStories", feed(31), ["top", 2]);
    expect(titles(t)[0]).toBe("Story 31");
    expect($(t, ".news-list-nav > span:not(.page-link)")?.textContent).toBe("page 2");
    expect(transitions(t.kernel)).toEqual(["hn · init", "hn · ClickedLink"]);
  });

  test("pointing at a link preloads its page; following it then shows at once", async () => {
    const t = await boot("/");
    await t.script.resolve("hn.getStories", feed(1), ["top", 1]);
    const link = $(t, 'a[href="/stories/1"]')!;
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await t.script.expectCall("hn.getStory", ["1"]);
    await t.script.resolve("hn.getStory", story(1, { comments_count: 1, comments: [comment(11)] }));
    await click(link);
    t.script.expectNoCalls();
    expect($(t, ".item-view h1")?.textContent).toBe("Story 1");
    expect(transitions(t.kernel).slice(-2)).toEqual(["hn · PointedAt", "hn · ClickedLink"]);
  });

  test("back and forward reuse the page instances: no refetch", async () => {
    const t = await boot("/");
    await t.script.resolve("hn.getStories", feed(1), ["top", 1]);
    await click($(t, 'a[href="/users/pg"]'));
    await t.script.resolve("hn.getUser", { id: "pg", created: "1160418092", karma: 155111, about: "", error: "" });
    expect($(t, ".user-view h1")?.textContent).toBe("User : pg");
    history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settled();
    expect(titles(t)).toHaveLength(30);
    t.script.expectNoCalls();
  });

  test("comment threads collapse through messages", async () => {
    const t = await boot("/stories/5");
    await t.script.resolve("hn.getStory", story(5, { comments_count: 2, comments: [comment(1, [comment(2)])] }));
    const details = $(t, "details.toggle") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    await click($(t, "details.toggle summary"));
    expect(details.open).toBe(false);
    expect(t.app.at("stories[5]").state()).toEqual({ id: "5", collapsed: { "1": true } });
    expect(transitions(t.kernel).at(-1)).toBe("hn/stories[5] · ToggledComment");
  });

  test("old pages are removed past `keep`, which disposes them; revisiting refetches", async () => {
    const t = await boot("/", 2);
    await t.script.resolve("hn.getStories", feed(1), ["top", 1]);
    await click($(t, 'a[href="/new"]'));
    await t.script.resolve("hn.getStories", feed(100), ["new", 1]);
    await click($(t, 'a[href="/show"]'));
    await t.script.resolve("hn.getStories", feed(200), ["show", 1]);
    expect(Object.keys(t.app.model.feeds).sort()).toEqual(["new:1", "show:1"]);
    await click($(t, 'a[href="/"]'));
    await t.script.expectCall("hn.getStories", ["top", 1]);
  });

  test("a failed load shows the error boundary; Try again reloads", async () => {
    const t = await boot("/ask");
    await t.script.reject("hn.getStories", new Error("503 Service Unavailable"), ["ask", 1]);
    expect(t.container.textContent).toContain("Could not load this page");
    await click([...t.container.querySelectorAll("button")].find(b => b.textContent === "Try again")!);
    await t.script.resolve("hn.getStories", feed(1), ["ask", 1]);
    expect(titles(t)).toHaveLength(30);
  });

  test("unknown paths render not found", async () => {
    const t = await boot("/nope/x");
    await settled();
    expect(t.container.textContent).toContain("Page not found.");
  });

  test("time travel: rewinding before a navigation shows the earlier page, with no network", async () => {
    const t = await boot("/");
    await t.script.resolve("hn.getStories", feed(1), ["top", 1]);
    await click($(t, 'a[href="/stories/3"]'));
    await t.script.resolve("hn.getStory", story(3, { comments_count: 1, comments: [comment(30)] }));
    await click($(t, "details.toggle summary") ?? $(t, ".item-view h1"));
    expect($(t, ".item-view h1")?.textContent).toBe("Story 3");
    const calls = liveCalls(t.kernel).length;

    const clicked = t.kernel.entries().find(e => e.kind === "transition" && e.name === "ClickedLink")!;
    t.kernel.rewind(clicked.seq - 1);
    await settled();
    expect(titles(t)).toHaveLength(30);
    // Right after the click the story had not arrived: the feed was still up.
    t.kernel.rewind(clicked.seq);
    await settled();
    expect(titles(t)).toHaveLength(30);
    expect($(t, ".item-view")).toBeNull();
    // From the entry where its response was recorded, the story shows.
    const loaded = t.kernel.entries().find(e => e.kind === "service" && e.path === "hn.getStory" && e.phase === "result")!;
    t.kernel.rewind(loaded.seq);
    await settled();
    expect($(t, ".item-view h1")?.textContent).toBe("Story 3");
    t.script.expectNoCalls();
    expect(liveCalls(t.kernel)).toHaveLength(calls);

    t.kernel.resume();
    await t.script.expectCall("hn.getStory", ["3"]);
    await t.script.resolve("hn.getStory", story(3, { comments_count: 1, comments: [comment(30)] }));
    expect($(t, ".item-view h1")?.textContent).toBe("Story 3");
  });
});
