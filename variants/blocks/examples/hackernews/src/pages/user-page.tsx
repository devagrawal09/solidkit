// A user's profile.
import { createMemo, Show } from "solid-js";
import { block, type DataCtx } from "@solidkit/blocks";
import type { Hn } from "../hn.ts";

export type Model = { id: string };

export function data(model: Model, { hn }: { hn: Hn }, ctx: DataCtx) {
  const user = createMemo(() => hn.getUser(model.id));
  ctx.refreshable(user);
  return { user };
}

export const UserPage = block<{ model: Model; msg: never; services: { hn: Hn }; args: Model }>()({
  name: "UserPage",
  requires: { hn: true },
  init: args => ({ id: args.id }),
  data,
  update: () => {},
  view: props => {
    const user = () => props.data.user();
    return (
      <div class="user-view">
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
      </div>
    );
  }
});
