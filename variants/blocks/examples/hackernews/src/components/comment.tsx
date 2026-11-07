import { For, Show } from "solid-js";
import { href } from "../routes.ts";
import type { CommentDefinition } from "../types.ts";

/** The original markup; whether a thread is collapsed is client state (`collapsed`). */
export default function Comment(props: { comment: CommentDefinition; collapsed: Record<string, true>; onToggle: (id: number) => void }) {
  return (
    <li class="comment">
      <div class="by">
        <a href={href({ name: "user", id: props.comment.user })}>{props.comment.user}</a> {props.comment.time_ago}
      </div>
      <div class="text" innerHTML={props.comment.content} />
      <Show when={props.comment.comments.length}>
        <details class="toggle" open={!props.collapsed[props.comment.id]}>
          <summary
            onClick={e => {
              e.preventDefault();
              props.onToggle(props.comment.id);
            }}
          >
            <span class="open-label">[-]</span>
            <span class="closed-label">[+] comments collapsed</span>
          </summary>
          <ul class="comment-children">
            <For each={props.comment.comments}>
              {comment => <Comment comment={comment} collapsed={props.collapsed} onToggle={props.onToggle} />}
            </For>
          </ul>
        </details>
      </Show>
    </li>
  );
}
