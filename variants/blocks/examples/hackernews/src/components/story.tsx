import { Show } from "solid-js";
import { href } from "../routes.ts";
import type { StoryDefinition } from "../types.ts";

export default function Story(props: { story: StoryDefinition }) {
  const item = () => href({ name: "story", id: String(props.story.id) });
  return (
    <li class="news-item">
      <span class="score">{props.story.points}</span>
      <span class="title">
        <Show when={props.story.url} fallback={<a href={item()}>{props.story.title}</a>}>
          <a href={props.story.url} target="_blank" rel="noreferrer">
            {props.story.title}
          </a>
          <span class="host"> ({props.story.domain})</span>
        </Show>
      </span>
      <br />
      <span class="meta">
        <Show when={props.story.type !== "job"} fallback={<a href={item()}>{props.story.time_ago}</a>}>
          by <a href={href({ name: "user", id: props.story.user })}>{props.story.user}</a> {props.story.time_ago} |{" "}
          <a href={item()}>{props.story.comments_count ? `${props.story.comments_count} comments` : "discuss"}</a>
        </Show>
      </span>
      <Show when={props.story.type !== "link"}>
        {" "}
        <span class="label">{props.story.type}</span>
      </Show>
    </li>
  );
}
