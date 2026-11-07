// The view against scripted services: links, the held page, back/forward,
// hover preload, and the URL following time travel.
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { afterEach, describe, expect, test } from "vitest";
import { scripted, settled } from "@solidkit/slices/testing";
import { App } from "../src/app";
import { hn } from "../src/hn";
import { News } from "../src/news";
import { parse } from "../src/routes";
import type { StoryDefinition } from "../src/types";

const item = (id: number, comments: StoryDefinition["comments"] = []): StoryDefinition => ({
  id,
  points: "10",
  url: "",
  title: `Story ${id}`,
  domain: "",
  type: "ask",
  time_ago: "1 hour ago",
  user: "pg",
  comments_count: comments.length,
  comments
});

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

async function mount() {
  history.replaceState(null, "", "/");
  const kernel = createKernel({ script: true });
  const script = scripted(kernel);
  const el = document.body.appendChild(document.createElement("div"));
  dispose = render(() => {
    const news = News.create(kernel, hn, parse(location.href));
    return <App news={news} />;
  }, el);
  flush();
  return { kernel, script, el };
}

const click = (a: Element | null | undefined) => a?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

describe("hackernews view", () => {
  test("Loading, the list, then a link: the list stays until the story is ready", async () => {
    const { script, el } = await mount();
    expect(el.querySelector(".page")?.textContent).toBe("Loading...");
    await script.resolve("hn.getStories", [item(1), item(2)], ["top", 1]);
    expect([...el.querySelectorAll(".news-item .title")].map(t => t.textContent)).toEqual(["Story 1", "Story 2"]);

    click(el.querySelector('.news-item a[href="/stories/2"]'));
    await script.expectCall("hn.getStory", ["2"]);
    expect(location.pathname).toBe("/stories/2");
    expect(el.querySelector(".news-list")).not.toBeNull(); // held on screen

    const reply = { id: 3, user: "dang", time_ago: "now", content: "<p>hello</p>", comments: [] };
    await script.resolve("hn.getStory", item(2, [reply]));
    expect(el.querySelector(".item-view h1")?.textContent).toBe("Story 2");
    expect(el.querySelector(".comment .text")?.innerHTML).toBe("<p>hello</p>");

    history.back();
    await new Promise(r => setTimeout(r, 20)); // popstate is async
    await script.expectCall("hn.getStories", ["top", 1]);
    await script.resolve("hn.getStories", [item(1)], ["top", 1]);
    expect(el.querySelector(".news-list")).not.toBeNull();
  });

  test("hovering a link preloads it", async () => {
    const { script, el } = await mount();
    await script.resolve("hn.getStories", [item(1)], ["top", 1]);
    el.querySelector('.news-item a[href="/users/pg"]')?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await script.expectCall("hn.getUser", ["pg"]);
  });

  test("the URL follows time travel", async () => {
    const { kernel, script, el } = await mount();
    await script.resolve("hn.getStories", [item(1)], ["top", 1]);
    const listed = kernel.entries().at(-1)!;
    click(el.querySelector('a[href="/new"]'));
    await script.expectCall("hn.getStories", ["new", 1]);
    await script.resolve("hn.getStories", [item(5)], ["new", 1]);
    expect(location.pathname).toBe("/new");

    kernel.rewind(listed.seq);
    await settled();
    expect(location.pathname).toBe("/top");
    expect(el.querySelector(".news-item .title")?.textContent).toBe("Story 1");
    click(el.querySelector('a[href="/show"]')); // ignored while rewound, and no page load either
    await settled();
    expect(location.pathname).toBe("/top");
    script.expectNoCalls();

    kernel.resume();
    await script.expectCall("hn.getStories", ["new", 1]);
    await script.resolve("hn.getStories", [item(5)], ["new", 1]);
    expect(location.pathname).toBe("/new");
    expect(el.querySelector(".news-item .title")?.textContent).toBe("Story 5");
  });
});
