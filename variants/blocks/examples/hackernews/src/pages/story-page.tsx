// A story with its comment thread. Which threads are collapsed is client
// state, so time travel restores it and each toggle is on the timeline.
import { createMemo, For, Show } from "solid-js";
import { block, variants, type DataCtx } from "@solidkit/blocks";
import Comment from "../components/comment.tsx";
import type { Hn } from "../hn.ts";
import { href } from "../routes.ts";

export type Model = { id: string; collapsed: Record<string, true> };

export type Msg = { type: "ToggledComment"; id: number };
export const Msg = variants<Msg>();

export function update(model: Model, msg: Msg): void {
  if (model.collapsed[msg.id]) delete model.collapsed[msg.id];
  else model.collapsed[msg.id] = true;
}

export function data(model: Model, { hn }: { hn: Hn }, ctx: DataCtx) {
  const story = createMemo(() => hn.getStory(model.id));
  ctx.refreshable(story);
  return { story };
}

export const StoryPage = block<{ model: Model; msg: Msg; services: { hn: Hn }; args: { id: string } }>()({
  name: "StoryPage",
  requires: { hn: true },
  init: args => ({ id: args.id, collapsed: {} }),
  data,
  update,
  view: props => {
    const story = () => props.data.story();
    const toggle = (id: number) => props.send(Msg.ToggledComment({ id }));
    return (
      <div class="item-view">
        <div class="item-view-header">
          <a href={story().url} target="_blank">
            <h1>{story().title}</h1>
          </a>
          <Show when={story().domain}>
            <span class="host">({story().domain})</span>
          </Show>
          <p class="meta">
            {story().points} points | by <a href={href({ name: "user", id: story().user })}>{story().user}</a> {story().time_ago}
          </p>
        </div>
        <div class="item-view-comments">
          <p class="item-view-comments-header">{story().comments_count ? story().comments_count + " comments" : "No comments yet."}</p>
          <ul class="comment-children">
            <For each={story().comments}>{comment => <Comment comment={comment} collapsed={props.model.collapsed} onToggle={toggle} />}</For>
          </ul>
        </div>
      </div>
    );
  }
});
