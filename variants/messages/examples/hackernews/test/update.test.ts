import { describe, expect, test } from "vitest";
import { expectActions, expectModel, send, story } from "@solidkit/messages/testing";
import { Act, init, Msg, update, type Model } from "../src/app.ts";
import { href, parse } from "../src/routes.ts";

const at = (url: string) => ({ model: init("http://localhost" + url) });
const route = (url: string) => parse("http://localhost" + url);

describe("routes", () => {
  test("URLs parse into typed routes and print back", () => {
    expect(parse("/")).toEqual({ name: "stories", type: "top", page: 1 });
    expect(parse("/new?page=3")).toEqual({ name: "stories", type: "new", page: 3 });
    expect(parse("/stories/30186326")).toEqual({ name: "story", id: "30186326" });
    expect(parse("/users/pg")).toEqual({ name: "user", id: "pg" });
    expect(parse("/nope")).toEqual({ name: "notFound", path: "/nope" });
    expect(parse("/stories/1/2")).toEqual({ name: "notFound", path: "/stories/1/2" });
    for (const url of ["/top", "/ask?page=2", "/stories/1", "/users/pg"]) expect(href(parse(url))).toBe(url);
  });
});

describe("hackernews update", () => {
  test("a link click moves the route and asks for the URL to follow", () => {
    story(
      { update },
      at("/"),
      send(Msg.ClickedLink({ url: "http://localhost/stories/123" })),
      expectModel<Model>(m => expect(m.route).toEqual({ name: "story", id: "123" })),
      expectActions(Act.pushUrl({ url: "/stories/123" }))
    );
  });

  test("back/forward moves the route without pushing", () => {
    story(
      { update },
      at("/stories/123"),
      send(Msg.ChangedUrl({ url: "http://localhost/show?page=2" })),
      expectModel<Model>(m => expect(m.route).toEqual({ name: "stories", type: "show", page: 2 })),
      expectActions()
    );
  });

  test("intent on a link preloads its route, but not the current page or unknown paths", () => {
    story(
      { update },
      at("/"),
      send(Msg.IntendedLink({ url: "http://localhost/users/pg" })),
      expectActions(Act.preload({ route: route("/users/pg") })),
      send(Msg.IntendedLink({ url: "http://localhost/top" }), Msg.IntendedLink({ url: "http://localhost/x/y/z" })),
      expectActions()
    );
  });
});
