// Typed routes: URLs parse into these, and href() builds them back.
import type { StoryTypes } from "./types";

export type Route =
  | { name: "stories"; type: StoryTypes; page: number }
  | { name: "story"; id: string }
  | { name: "user"; id: string }
  | { name: "notFound"; path: string };

const feeds: readonly StoryTypes[] = ["top", "new", "show", "ask", "job"];
const isFeed = (value: string): value is StoryTypes => (feeds as readonly string[]).includes(value);

export function parse(href: string): Route {
  const url = new URL(href, "http://localhost");
  const [first, second, ...rest] = url.pathname.split("/").filter(Boolean);
  const page = Number(url.searchParams.get("page")) || 1;
  if (!first) return { name: "stories", type: "top", page };
  if (!second && isFeed(first)) return { name: "stories", type: first, page };
  if (second && !rest.length && first === "stories") return { name: "story", id: second };
  if (second && !rest.length && first === "users") return { name: "user", id: second };
  return { name: "notFound", path: url.pathname };
}

export function href(route: Route): string {
  switch (route.name) {
    case "stories":
      return route.page > 1 ? `/${route.type}?page=${route.page}` : `/${route.type}`;
    case "story":
      return `/stories/${route.id}`;
    case "user":
      return `/users/${route.id}`;
    case "notFound":
      return route.path;
  }
}

export const sameRoute = (a: Route, b: Route) => href(a) === href(b);
