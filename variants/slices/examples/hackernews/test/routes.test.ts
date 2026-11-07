// Pure tests: typed routes and the nav slice.
import { describe, expect, test } from "vitest";
import { given } from "@solidkit/slices/testing";
import { href, parse } from "../src/routes";
import { navSlice } from "../src/state";

describe("routes", () => {
  test("URLs parse into typed routes", () => {
    expect(parse("/")).toEqual({ name: "stories", type: "top", page: 1 });
    expect(parse("/new?page=3")).toEqual({ name: "stories", type: "new", page: 3 });
    expect(parse("/job")).toEqual({ name: "stories", type: "job", page: 1 });
    expect(parse("/stories/30186326")).toEqual({ name: "story", id: "30186326" });
    expect(parse("https://example.com/users/pg")).toEqual({ name: "user", id: "pg" });
    expect(parse("/best")).toEqual({ name: "notFound", path: "/best" });
    expect(parse("/stories/1/2")).toEqual({ name: "notFound", path: "/stories/1/2" });
  });

  test("href builds them back", () => {
    for (const url of ["/top", "/show?page=2", "/stories/1", "/users/pg"]) expect(href(parse(url))).toBe(url);
  });

  test("navigating replaces the route", () => {
    const [state, { navigated }] = given(navSlice);
    navigated({ name: "user", id: "pg" });
    expect(state.route).toEqual({ name: "user", id: "pg" });
  });
});
