// Hacker News as one program. The route is client state (what the user asked
// to see); the page is server data, derived from it by one async memo.
import { createMemo } from "solid-js";
import { onLinkIntent, onUrlChange, onUrlRequest, variants, type Handlers, type ProgramSpec } from "@solidkit/messages";
import type { hn, nav } from "./hn.ts";
import { href, parse, type Route } from "./routes.ts";
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types.ts";

export type Services = { hn: typeof hn; nav: typeof nav };

export type Model = { route: Route };
export const init = (url: string): Model => ({ route: parse(url) });

export type Msg =
  | { type: "ClickedLink"; url: string }
  | { type: "ChangedUrl"; url: string }
  | { type: "IntendedLink"; url: string };
export const Msg = variants<Msg>();

export type Act = { type: "pushUrl"; url: string } | { type: "preload"; route: Route };
export const Act = variants<Act>();

const local = (url: string) => {
  const { pathname, search } = new URL(url, "http://localhost");
  return pathname + search;
};

export function update(model: Model, msg: Msg): Act | void {
  switch (msg.type) {
    case "ClickedLink":
      model.route = parse(msg.url);
      return Act.pushUrl({ url: local(msg.url) });
    case "ChangedUrl": // back/forward: the URL is already there
      model.route = parse(msg.url);
      return;
    case "IntendedLink": {
      const route = parse(msg.url);
      if (route.name === "notFound" || href(route) === href(model.route)) return;
      return Act.preload({ route });
    }
  }
}

// ── Data: one async derivation keyed on the route ─────────────────────────────

/** What's on screen. While the next route loads, Solid keeps this one up. */
export type Page =
  | { name: "stories"; type: StoryTypes; page: number; stories: StoryDefinition[] }
  | { name: "story"; story: StoryDefinition }
  | { name: "user"; id: string; user: UserDefinition | null }
  | { name: "notFound"; path: string };

async function fetchPage(api: Services["hn"], route: Exclude<Route, { name: "notFound" }>): Promise<Page> {
  switch (route.name) {
    case "stories":
      return { ...route, stories: await api.getStories(route.type, route.page) };
    case "story":
      return { name: "story", story: await api.getStory(route.id) };
    case "user":
      return { name: "user", id: route.id, user: await api.getUser(route.id) };
  }
}

/** A short-lived request cache in front of the recorded services, as the
 * router's query() is: a preload and the navigation after it share one request. */
export function pages(api: Services["hn"], ttl = 30_000) {
  const cache = new Map<string, { at: number; page: Promise<Page> }>();
  return (route: Route): Page | Promise<Page> => {
    if (route.name === "notFound") return route;
    const key = href(route);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.page;
    const page = fetchPage(api, route);
    cache.set(key, { at: Date.now(), page });
    page.catch(() => cache.delete(key));
    return page;
  };
}

export function data(model: Model, { hn }: Services) {
  const load = pages(hn);
  const page = createMemo<Page>(() => load(model.route));
  return { page, load };
}
export type Data = ReturnType<typeof data>;

export const actions = ({ load }: Data, { nav }: Services): Handlers<Act, Msg> => ({
  *pushUrl({ url }) {
    yield nav.push(url);
  },
  *preload({ route }) {
    void load(route); // warm the cache; the navigation, if it comes, reads it
  }
});

export const hackernews: ProgramSpec<Model, Msg, Act, Data, Services, string> = {
  name: "hackernews",
  init,
  update,
  data,
  sources: data => [data.page],
  actions,
  subscriptions: () => [
    onUrlRequest(url => Msg.ClickedLink({ url: url.href })),
    onUrlChange(url => Msg.ChangedUrl({ url: url.href })),
    onLinkIntent(url => Msg.IntendedLink({ url: url.href }))
  ]
};
