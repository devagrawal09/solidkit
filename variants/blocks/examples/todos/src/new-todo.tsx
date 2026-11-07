// NewTodo: the header input. It owns the draft text and reports a title.
import { block, variants } from "@solidkit/blocks";

export type Model = { text: string };

export type Msg = { type: "ChangedText"; text: string } | { type: "Submitted"; id: string };
export const Msg = variants<Msg>();

/** Reported to the parent, which decides what an entered title means. */
export type Out = { type: "EnteredTitle"; id: string; title: string };

export function update(model: Model, msg: Msg, ctx: { emit(out: Out): void }): void {
  switch (msg.type) {
    case "ChangedText":
      model.text = msg.text;
      return;
    case "Submitted": {
      const title = model.text.trim();
      if (!title) return;
      model.text = "";
      ctx.emit({ type: "EnteredTitle", id: msg.id, title });
      return;
    }
  }
}

// Ids are made in the event handler and carried by the message, so update stays pure.
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const NewTodo = block<{ model: Model; msg: Msg; out: Out }>()({
  name: "NewTodo",
  requires: {},
  init: () => ({ text: "" }),
  update,
  view: props => (
    <header class="header">
      <h1>todos</h1>
      <input
        class="new-todo"
        placeholder="What needs to be done?"
        autofocus
        value={props.model.text}
        onInput={e => props.send(Msg.ChangedText({ text: e.currentTarget.value }))}
        onKeyDown={e => {
          if (e.key === "Enter") props.send(Msg.Submitted({ id: newId() }));
        }}
      />
    </header>
  )
});
