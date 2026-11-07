// The router shell: the route is client state, links and back/forward are
// messages, and every page is a keyed block instance. A page's instance (and
// so its data) is created when it is first shown or pointed at, kept while
// recent, and removed (disposed) once `keep` newer pages exist.
import { Errored, Loading, Match, Switch } from "solid-js";
import { block, keyed, variants, type UpdateCtx } from "@solidkit/blocks";
import Nav from "./components/nav.tsx";
import type { Hn } from "./hn.ts";
import { Feed, type Model as FeedModel } from "./pages/feed.tsx";
import { StoryPage, type Model as StoryModel } from "./pages/story-page.tsx";
import { UserPage, type Model as UserModel } from "./pages/user-page.tsx";
import { href, pageKey, parse, type PageKey, type Route } from "./routes.ts";

export type Model = {
  route: Route;
  /** Page instances, most recently used first. */
  recent: PageKey[];
  keep: number;
  feeds: Record<string, FeedModel>;
  stories: Record<string, StoryModel>;
  users: Record<string, UserModel>;
};

export type Args = { href: string; keep?: number };

export type Msg =
  | { type: "ClickedLink"; href: string }
  | { type: "ChangedUrl"; href: string }
  | { type: "PointedAt"; href: string };
export const Msg = variants<Msg>();

export type Act = { type: "pushUrl"; href: string };

type Types = { model: Model; msg: Msg; act: Act; services: { hn: Hn }; args: Args };

// The first page's instance exists from the start.
const children = {
  feeds: keyed(Feed, {
    initial: (args: Args) => {
      const r = parse(args.href);
      return r.name === "stories" ? { [`${r.type}:${r.page}`]: { type: r.type, page: r.page } } : {};
    }
  }),
  stories: keyed(StoryPage, {
    initial: (args: Args) => {
      const r = parse(args.href);
      return r.name === "story" ? { [r.id]: { id: r.id } } : {};
    }
  }),
  users: keyed(UserPage, {
    initial: (args: Args) => {
      const r = parse(args.href);
      return r.name === "user" ? { [r.id]: { id: r.id } } : {};
    }
  })
};

type Ctx = UpdateCtx<Types, typeof children, undefined>;

/** Makes sure `route`'s page instance exists and is most recent; drops the oldest past `keep`. */
export function open(model: Model, route: Route, ctx: Ctx): void {
  const page = pageKey(route);
  if (!page) return;
  if (route.name === "stories" && !ctx.blocks.feeds.has(page.key)) ctx.blocks.feeds.insert(page.key, { type: route.type, page: route.page });
  if (route.name === "story" && !ctx.blocks.stories.has(page.key)) ctx.blocks.stories.insert(page.key, { id: route.id });
  if (route.name === "user" && !ctx.blocks.users.has(page.key)) ctx.blocks.users.insert(page.key, { id: route.id });
  const same = (a: PageKey, b: PageKey | undefined) => !!b && a.kind === b.kind && a.key === b.key;
  model.recent = [page, ...model.recent.filter(p => !same(p, page))];
  const current = pageKey(model.route);
  for (let i = model.recent.length - 1; i >= 0 && model.recent.length > model.keep; i--) {
    const old = model.recent[i];
    if (same(old, current) || same(old, page)) continue;
    ctx.blocks[old.kind].remove(old.key);
    model.recent.splice(i, 1);
  }
}

export function update(model: Model, msg: Msg, ctx: Ctx): Act | void {
  const route = parse(msg.href);
  switch (msg.type) {
    case "ClickedLink":
      if (href(route) === href(model.route)) return;
      model.route = route;
      open(model, route, ctx);
      return { type: "pushUrl", href: href(route) };
    case "ChangedUrl":
      model.route = route;
      open(model, route, ctx);
      return;
    case "PointedAt":
      open(model, route, ctx);
      return;
  }
}

const sameOrigin = (e: Event) => {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  return a && a.origin === location.origin && !a.target && !a.hasAttribute("download") ? a : null;
};

export const Shell = block<Types>()({
  name: "hn",
  requires: { hn: true },
  children,
  init: args => {
    const route = parse(args.href);
    const page = pageKey(route);
    return { route, recent: page ? [page] : [], keep: args.keep ?? 20 };
  },
  update,
  actions: () => ({
    *pushUrl({ href }) {
      history.pushState(null, "", href);
      window.scrollTo(0, 0);
    }
  }),
  subscriptions: model => [
    {
      key: "navigation",
      start: send => {
        const onClick = (e: MouseEvent) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const a = sameOrigin(e);
          if (!a) return;
          e.preventDefault();
          send(Msg.ClickedLink({ href: a.pathname + a.search }));
        };
        const onPopState = () => send(Msg.ChangedUrl({ href: location.pathname + location.search }));
        document.addEventListener("click", onClick);
        window.addEventListener("popstate", onPopState);
        return () => {
          document.removeEventListener("click", onClick);
          window.removeEventListener("popstate", onPopState);
        };
      }
    },
    {
      // Hover and focus preload: pointing at a link opens its page instance, whose data starts loading.
      key: "intent",
      start: send => {
        const onIntent = (e: Event) => {
          const a = sameOrigin(e);
          const page = a && pageKey(parse(a.href));
          if (a && page && !(page.key in model[page.kind])) send(Msg.PointedAt({ href: a.pathname + a.search }));
        };
        document.addEventListener("mouseover", onIntent);
        document.addEventListener("focusin", onIntent);
        return () => {
          document.removeEventListener("mouseover", onIntent);
          document.removeEventListener("focusin", onIntent);
        };
      }
    }
  ],
  view: props => {
    const page = (kind: PageKey["kind"]) => {
      const p = pageKey(props.model.route);
      return p?.kind === kind ? p.key : undefined;
    };
    return (
      <>
        <Nav />
        <div class="page">
          <Errored
            fallback={(err, reset) => (
              <div class="news-list-nav">
                Could not load this page ({String(err())}). <button onClick={reset}>Try again</button>
              </div>
            )}
          >
            <Loading fallback={<div class="news-list-nav">Loading...</div>}>
              <Switch fallback={<div class="news-list-nav">Page not found.</div>}>
                <Match when={page("feeds")} keyed>
                  {key => <props.blocks.feeds key={key} />}
                </Match>
                <Match when={page("stories")} keyed>
                  {key => <props.blocks.stories key={key} />}
                </Match>
                <Match when={page("users")} keyed>
                  {key => <props.blocks.users key={key} />}
                </Match>
              </Switch>
            </Loading>
          </Errored>
        </div>
      </>
    );
  }
});
