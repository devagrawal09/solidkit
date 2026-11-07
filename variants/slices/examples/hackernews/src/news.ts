// The app as one feature: the route (a slice), the page derived from it, and
// preloading. There are no mutations to the server, so no actions.
import { createMemo } from "solid-js";
import { feature } from "@solidkit/slices";
import type { HN } from "./hn";
import type { Route } from "./routes";
import { navSlice } from "./state";
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types";

/** What is on screen: one page, derived from the route. */
export type Page =
  | { name: "stories"; type: StoryTypes; page: number; stories: StoryDefinition[] }
  | { name: "story"; story: StoryDefinition }
  | { name: "user"; user: UserDefinition }
  | { name: "notFound"; path: string };

export const News = feature((kit, api: HN, start: Route) => {
  const [nav, { navigated }] = kit.use(navSlice, { route: start });
  const { hn } = kit.services({ hn: api });

  // One async derivation keyed on the route. When the route changes, Solid
  // holds the current page on screen until this one resolves.
  const page = createMemo<Page>(async () => {
    const route = { ...nav.route };
    switch (route.name) {
      case "stories":
        return { ...route, stories: await hn.getStories(route.type, route.page) };
      case "story":
        return { name: "story", story: await hn.getStory(route.id) };
      case "user":
        return { name: "user", user: await hn.getUser(route.id) };
      case "notFound":
        return route;
    }
  });
  kit.refreshable(page);

  /** Warms the cache for a link the user is about to follow (not while rewound). */
  function preload(route: Route) {
    if (kit.kernel.travelingAt() !== null) return;
    if (route.name === "stories") void hn.getStories(route.type, route.page);
    if (route.name === "story") void hn.getStory(route.id);
    if (route.name === "user") void hn.getUser(route.id);
  }

  return { nav, navigated, page, preload };
});

export type NewsApp = ReturnType<typeof News.create>;
