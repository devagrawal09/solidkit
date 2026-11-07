import { createEffect, For, Loading, Match, onSettled, Show, Switch } from "solid-js";
import Comment from "./components/comment";
import Nav from "./components/nav";
import Story from "./components/story";
import type { NewsApp } from "./news";
import { href, parse, sameRoute } from "./routes";
import type { StoryDefinition, StoryTypes, UserDefinition } from "./types";

const linkOf = (e: Event) => (e.target instanceof Element ? e.target.closest("a") : null);

/** Links, back/forward and hover preloads become calls into the feature. */
function useNavigation(news: NewsApp) {
  let warmed = "";
  onSettled(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = linkOf(e);
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      e.preventDefault();
      const url = a.pathname + a.search;
      if (news.navigated(parse(url))) history.pushState(null, "", url);
    };
    const warm = (e: Event) => {
      const a = linkOf(e);
      if (!a || a.target || a.origin !== location.origin || a.href === warmed) return;
      warmed = a.href;
      news.preload(parse(a.href));
    };
    const popstate = () => news.navigated(parse(location.href));
    document.addEventListener("click", click);
    document.addEventListener("pointerover", warm);
    document.addEventListener("focusin", warm);
    window.addEventListener("popstate", popstate);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("pointerover", warm);
      document.removeEventListener("focusin", warm);
      window.removeEventListener("popstate", popstate);
    };
  });
  // The URL follows the route, so it follows time travel too.
  createEffect(
    () => ({ ...news.nav.route }),
    route => {
      if (!sameRoute(parse(location.href), route)) history.replaceState(null, "", href(route));
    }
  );
}

export function App(props: { news: NewsApp }) {
  useNavigation(props.news);
  const stories = () => {
    const p = props.news.page();
    return p.name === "stories" ? p : undefined;
  };
  const story = () => {
    const p = props.news.page();
    return p.name === "story" ? p : undefined;
  };
  const user = () => {
    const p = props.news.page();
    return p.name === "user" ? p : undefined;
  };
  return (
    <>
      <Nav />
      <div class="page">
        <Loading fallback={<div class="news-list-nav">Loading...</div>}>
          <Switch>
            <Match when={stories()}>{p => <Stories type={p().type} page={p().page} stories={p().stories} />}</Match>
            <Match when={story()}>{p => <StoryPage story={p().story} />}</Match>
            <Match when={user()}>{p => <UserPage user={p().user} />}</Match>
          </Switch>
        </Loading>
      </div>
    </>
  );
}

function Stories(props: { type: StoryTypes; page: number; stories: StoryDefinition[] }) {
  return (
    <div class="news-view">
      <div class="news-list-nav">
        <Show
          when={props.page > 1}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              {"<"} prev
            </span>
          }
        >
          <a class="page-link" href={`/${props.type}?page=${props.page - 1}`} aria-label="Previous Page">
            {"<"} prev
          </a>
        </Show>
        <span>page {props.page}</span>
        <Show
          when={props.stories && props.stories.length >= 29}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              more {">"}
            </span>
          }
        >
          <a class="page-link" href={`/${props.type}?page=${props.page + 1}`} aria-label="Next Page">
            more {">"}
          </a>
        </Show>
      </div>
      <main class="news-list">
        <For each={props.stories}>{story => <Story story={story} />}</For>
      </main>
    </div>
  );
}

function StoryPage(props: { story: StoryDefinition }) {
  return (
    <div class="item-view">
      <div class="item-view-header">
        <a href={props.story.url} target="_blank">
          <h1>{props.story.title}</h1>
        </a>
        <Show when={props.story.domain}>
          <span class="host">({props.story.domain})</span>
        </Show>
        <p class="meta">
          {props.story.points} points | by <a href={`/users/${props.story.user}`}>{props.story.user}</a>{" "}
          {props.story.time_ago}
        </p>
      </div>
      <div class="item-view-comments">
        <p class="item-view-comments-header">
          {props.story.comments_count ? props.story.comments_count + " comments" : "No comments yet."}
        </p>
        <ul class="comment-children">
          <For each={props.story.comments}>{comment => <Comment comment={comment} />}</For>
        </ul>
      </div>
    </div>
  );
}

function UserPage(props: { user: UserDefinition }) {
  return (
    <div class="user-view">
      <h1>User : {props.user.id}</h1>
      <ul class="meta">
        <li>
          <span class="label">Created:</span> {props.user.created}
        </li>
        <li>
          <span class="label">Karma:</span> {props.user.karma}
        </li>
        <Show when={props.user.about}>
          <li innerHTML={props.user.about} class="about" />
        </Show>
      </ul>
      <p class="links">
        <a href={`https://news.ycombinator.com/submitted?id=${props.user.id}`}>submissions</a> |{" "}
        <a href={`https://news.ycombinator.com/threads?id=${props.user.id}`}>comments</a>
      </p>
    </div>
  );
}
