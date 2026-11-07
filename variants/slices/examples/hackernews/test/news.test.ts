// Scenario tests: the real feature (route slice, page derivation, preload)
// against scripted services.
import { createEffect, createRoot, isPending } from "solid-js";
import { createKernel } from "@solidkit/kernel";
import { describe, expect, test } from "vitest";
import { expectReplayable, scripted, settled } from "@solidkit/slices/testing";
import { hn } from "../src/hn";
import { News } from "../src/news";
import { parse } from "../src/routes";
import type { StoryDefinition, UserDefinition } from "../src/types";

const item = (id: number): StoryDefinition => ({
  id,
  points: "1",
  url: `https://example.com/${id}`,
  title: `Story ${id}`,
  domain: "example.com",
  type: "link",
  time_ago: "1 hour ago",
  user: "pg",
  comments_count: 0,
  comments: []
});
const pg: UserDefinition = { error: "", id: "pg", created: "1160418092", karma: 157316, about: "Bug fixer." };

async function start(url = "/") {
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const seen: string[] = [];
  const news = createRoot(() => {
    const news = News.create(kernel, hn, parse(url));
    // Stand-in for the view: what is on screen, and whether a navigation is pending.
    createEffect(
      () => {
        const p = news.page();
        return `${p.name === "stories" ? `${p.type}:${p.page}:${p.stories.length}` : p.name === "story" ? `story:${p.story.id}` : p.name === "user" ? `user:${p.user.id}` : "notFound"}${isPending(news.page) ? " (pending)" : ""}`;
      },
      label => void seen.push(label)
    );
    return news;
  });
  return { kernel, script, news, seen };
}

describe("hackernews", () => {
  test("the first page loads from the route", async () => {
    const { script, seen } = await start("/new?page=2");
    await script.expectCall("hn.getStories", ["new", 2]);
    await script.resolve("hn.getStories", [item(1), item(2)]);
    expect(seen.at(-1)).toBe("new:2:2");
  });

  test("a navigation keeps the current page on screen until the next one is ready", async () => {
    const { script, news, seen } = await start();
    await script.resolve("hn.getStories", [item(1)]);
    news.navigated({ name: "story", id: "1" });
    await script.expectCall("hn.getStory", ["1"]);
    expect(seen.at(-1)).toBe("top:1:1 (pending)");
    await script.resolve("hn.getStory", item(1));
    expect(seen.at(-1)).toBe("story:1");
    expect(news.nav.route).toEqual({ name: "story", id: "1" });
  });

  test("a newer navigation supersedes one still loading", async () => {
    const { script, news, seen } = await start();
    await script.resolve("hn.getStories", [item(1)]);
    news.navigated({ name: "story", id: "1" });
    await script.expectCall("hn.getStory", ["1"]);
    news.navigated({ name: "user", id: "pg" });
    await script.expectCall("hn.getUser", ["pg"]);
    await script.resolve("hn.getUser", pg);
    expect(seen.at(-1)).toBe("user:pg");
    await script.resolve("hn.getStory", item(1)); // the stale answer lands nowhere
    expect(seen.at(-1)).toBe("user:pg");
  });

  test("preload asks the service ahead of the click", async () => {
    const { script, news } = await start();
    await script.resolve("hn.getStories", [item(1)]);
    news.preload(parse("/users/pg"));
    await script.expectCall("hn.getUser", ["pg"]);
  });

  test("time travel: rewinding shows an earlier page from the recording, with no live calls", async () => {
    const { kernel, script, news, seen } = await start();
    await script.resolve("hn.getStories", [item(1), item(2)]);
    news.navigated({ name: "story", id: "2" });
    await script.expectCall("hn.getStory", ["2"]);
    await script.resolve("hn.getStory", item(2));
    const onStory = kernel.entries().at(-1)!;
    news.navigated({ name: "user", id: "pg" });
    await script.expectCall("hn.getUser", ["pg"]);
    await script.resolve("hn.getUser", pg);
    expect(seen.at(-1)).toBe("user:pg");

    kernel.rewind(onStory.seq);
    await settled();
    expect(news.nav.route).toEqual({ name: "story", id: "2" });
    expect(seen.at(-1)).toBe("story:2");
    script.expectNoCalls();

    const first = kernel.entries().find(e => e.kind === "service" && e.phase === "result")!;
    kernel.rewind(first.seq);
    await settled();
    expect(seen.at(-1)).toBe("top:1:2");
    expect(news.navigated({ name: "user", id: "dang" })).toBe(false); // input is ignored while rewound
    news.preload(parse("/users/dang"));
    script.expectNoCalls();

    kernel.resume();
    await script.expectCall("hn.getUser", ["pg"]); // live again: the page is re-derived
    await script.resolve("hn.getUser", pg);
    expect(seen.at(-1)).toBe("user:pg");
    expectReplayable(kernel);
  });
});
