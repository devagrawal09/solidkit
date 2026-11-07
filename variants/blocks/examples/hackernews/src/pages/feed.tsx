// A feed page (/, /new, /show, /ask, /job, ?page=N). One instance per feed
// and page, kept by the shell while recent: its memo is that page's cache.
import { createMemo, For, Show } from "solid-js";
import { block, type DataCtx } from "@solidkit/blocks";
import Story from "../components/story.tsx";
import type { Hn } from "../hn.ts";
import { href } from "../routes.ts";
import type { StoryTypes } from "../types.ts";

export type Model = { type: StoryTypes; page: number };

export function data(model: Model, { hn }: { hn: Hn }, ctx: DataCtx) {
  const stories = createMemo(() => hn.getStories(model.type, model.page));
  ctx.refreshable(stories);
  return { stories };
}

export const Feed = block<{ model: Model; msg: never; services: { hn: Hn }; args: Model }>()({
  name: "Feed",
  requires: { hn: true },
  init: args => ({ type: args.type, page: args.page }),
  data,
  update: () => {},
  view: props => {
    const page = () => props.model.page;
    const type = () => props.model.type;
    return (
      <div class="news-view">
        <div class="news-list-nav">
          <Show
            when={page() > 1}
            fallback={
              <span class="page-link disabled" aria-disabled="true">
                {"<"} prev
              </span>
            }
          >
            <a class="page-link" href={href({ name: "stories", type: type(), page: page() - 1 })} aria-label="Previous Page">
              {"<"} prev
            </a>
          </Show>
          <span>page {page()}</span>
          <Show
            when={props.data.stories().length >= 29}
            fallback={
              <span class="page-link disabled" aria-disabled="true">
                more {">"}
              </span>
            }
          >
            <a class="page-link" href={href({ name: "stories", type: type(), page: page() + 1 })} aria-label="Next Page">
              more {">"}
            </a>
          </Show>
        </div>
        <main class="news-list">
          <For each={props.data.stories()}>{story => <Story story={story} />}</For>
        </main>
      </div>
    );
  }
});
