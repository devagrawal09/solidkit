// Pure tests: routes and the shell's navigation logic.
import { describe, expect, test } from "vitest";
import { testUpdate } from "@solidkit/blocks/testing";
import { href, parse, type Route } from "../src/routes.ts";
import { Msg, Shell, type Model } from "../src/shell.tsx";
import { Msg as StoryMsg, StoryPage } from "../src/pages/story-page.tsx";

describe("routes", () => {
  test("parse and href round-trip every route", () => {
    const routes: Route[] = [
      { name: "stories", type: "top", page: 1 },
      { name: "stories", type: "new", page: 3 },
      { name: "story", id: "30186326" },
      { name: "user", id: "pg" }
    ];
    for (const route of routes) expect(parse(href(route))).toEqual(route);
    expect(parse("/top?page=2")).toEqual({ name: "stories", type: "top", page: 2 });
    expect(parse("/nope/x")).toEqual({ name: "notFound", path: "/nope/x" });
  });
});

describe("shell", () => {
  const home = (): Model => ({
    route: { name: "stories", type: "top", page: 1 },
    recent: [{ kind: "feeds", key: "top:1" }],
    keep: 2,
    feeds: { "top:1": { type: "top", page: 1 } },
    stories: {},
    users: {}
  });

  test("a link click shows the route, opens its page instance and pushes the URL", () => {
    const r = testUpdate(Shell, home(), Msg.ClickedLink({ href: "/stories/7" }));
    expect(r.model.route).toEqual({ name: "story", id: "7" });
    expect(r.model.stories).toEqual({ "7": { id: "7", collapsed: {} } });
    expect(r.acts).toEqual([{ type: "pushUrl", href: "/stories/7" }]);
    expect(testUpdate(Shell, home(), Msg.ClickedLink({ href: "/" })).acts).toEqual([]);
  });

  test("pointing at a link opens its page without navigating", () => {
    const r = testUpdate(Shell, home(), Msg.PointedAt({ href: "/users/pg" }));
    expect(r.model.route).toEqual(home().route);
    expect(Object.keys(r.model.users)).toEqual(["pg"]);
  });

  test("past `keep`, the least recent page is removed, never the current one", () => {
    let model = home();
    model = testUpdate(Shell, model, Msg.ClickedLink({ href: "/new" })).model;
    const r = testUpdate(Shell, model, Msg.PointedAt({ href: "/show" }));
    expect(Object.keys(r.model.feeds).sort()).toEqual(["new:1", "show:1"]);
    expect(r.ops).toContainEqual({ block: "feeds", key: "top:1", op: "remove", args: [] });
    expect(r.model.recent.map(p => p.key)).toEqual(["show:1", "new:1"]);
  });

  test("a comment thread collapses and expands", () => {
    let r = testUpdate(StoryPage, { id: "1", collapsed: {} }, StoryMsg.ToggledComment({ id: 42 }));
    expect(r.model.collapsed).toEqual({ "42": true });
    r = testUpdate(StoryPage, r.model, StoryMsg.ToggledComment({ id: 42 }));
    expect(r.model.collapsed).toEqual({});
  });
});
