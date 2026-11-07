// Typed routes: the route is client state. The same module parses URLs and
// builds every internal href.
import type { StoryTypes } from "./types.ts";

export type Route =
  | { name: "stories"; type: StoryTypes; page: number }
  | { name: "story"; id: string }
  | { name: "user"; id: string }
  | { name: "notFound"; path: string };

const feeds: readonly string[] = ["top", "new", "show", "ask", "job"];
const isFeed = (s: string): s is StoryTypes => feeds.includes(s);
const pageParam = (url: URL) => Number(url.searchParams.get("page")) || 1;

export function parse(href: string): Route {
  const url = new URL(href, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "stories", type: "top", page: pageParam(url) };
  if (parts.length === 1 && isFeed(parts[0])) return { name: "stories", type: parts[0], page: pageParam(url) };
  if (parts.length === 2 && parts[0] === "stories") return { name: "story", id: parts[1] };
  if (parts.length === 2 && parts[0] === "users") return { name: "user", id: parts[1] };
  return { name: "notFound", path: url.pathname };
}

export function href(route: Route): string {
  switch (route.name) {
    case "stories":
      return route.page === 1 && route.type === "top" ? "/" : `/${route.type}?page=${route.page}`;
    case "story":
      return `/stories/${route.id}`;
    case "user":
      return `/users/${route.id}`;
    case "notFound":
      return route.path;
  }
}

/** Which page instance shows a route: its keyed collection and its key there. */
export type PageKey = { readonly kind: "feeds" | "stories" | "users"; readonly key: string };

export function pageKey(route: Route): PageKey | undefined {
  switch (route.name) {
    case "stories":
      return { kind: "feeds", key: `${route.type}:${route.page}` };
    case "story":
      return { kind: "stories", key: route.id };
    case "user":
      return { kind: "users", key: route.id };
    case "notFound":
      return undefined;
  }
}
