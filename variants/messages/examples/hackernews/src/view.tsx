import { For, Loading, Match, Show, Switch } from "solid-js";
import { program, type View } from "@solidkit/messages";
import Comment from "./components/comment.tsx";
import Nav from "./components/nav.tsx";
import Story from "./components/story.tsx";
import { hackernews, type Data, type Model, type Msg, type Page } from "./app.ts";

type StoriesPage = Extract<Page, { name: "stories" }>;
type UserPage = Extract<Page, { name: "user" }>;

function Stories(props: { page: StoriesPage }) {
  return (
    <div class="news-view">
      <div class="news-list-nav">
        <Show
          when={props.page.page > 1}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              {"<"} prev
            </span>
          }
        >
          <a class="page-link" href={`/${props.page.type}?page=${props.page.page - 1}`} aria-label="Previous Page">
            {"<"} prev
          </a>
        </Show>
        <span>page {props.page.page}</span>
        <Show
          when={props.page.stories.length >= 29}
          fallback={
            <span class="page-link disabled" aria-disabled="true">
              more {">"}
            </span>
          }
        >
          <a class="page-link" href={`/${props.page.type}?page=${props.page.page + 1}`} aria-label="Next Page">
            more {">"}
          </a>
        </Show>
      </div>
      <main class="news-list">
        <For each={props.page.stories}>{story => <Story story={story} />}</For>
      </main>
    </div>
  );
}

function StoryView(props: { story: Extract<Page, { name: "story" }>["story"] }) {
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

function User(props: { page: UserPage }) {
  return (
    <div class="user-view">
      <Show when={props.page.user} fallback={<h1>User : {props.page.id} not found.</h1>}>
        {user => (
          <>
            <h1>User : {user().id}</h1>
            <ul class="meta">
              <li>
                <span class="label">Created:</span> {user().created}
              </li>
              <li>
                <span class="label">Karma:</span> {user().karma}
              </li>
              <Show when={user().about}>
                <li innerHTML={user().about} class="about" />
              </Show>
            </ul>
            <p class="links">
              <a href={`https://news.ycombinator.com/submitted?id=${user().id}`}>submissions</a> |{" "}
              <a href={`https://news.ycombinator.com/threads?id=${user().id}`}>comments</a>
            </p>
          </>
        )}
      </Show>
    </div>
  );
}

function PageView(props: { page: Page }) {
  return (
    <Switch>
      <Match when={props.page.name === "stories" ? props.page : undefined}>{page => <Stories page={page()} />}</Match>
      <Match when={props.page.name === "story" ? props.page : undefined}>{page => <StoryView story={page().story} />}</Match>
      <Match when={props.page.name === "user" ? props.page : undefined}>{page => <User page={page()} />}</Match>
      <Match when={props.page.name === "notFound" ? props.page : undefined}>
        {page => <div class="news-list-nav">Not found: {page().path}</div>}
      </Match>
    </Switch>
  );
}

// Link clicks, back/forward and hover preloads arrive as messages (subscriptions
// in app.ts), so the view is plain markup with plain <a href>s.
export const view: View<Model, Msg, Data> = (_model, _send, { page }) => (
  <>
    <Nav />
    <div class="page">
      <Loading fallback={<div class="news-list-nav">Loading...</div>}>
        <PageView page={page()} />
      </Loading>
    </div>
  </>
);

export const App = program({ ...hackernews, view });
