import { For } from "solid-js";
import { render } from "@solidjs/web";

function Counter(props: { count: number; doubled: number }) {
  // One string child keeps the DOM assertion simple.
  return <p>{`count=${props.count} doubled=${props.doubled}`}</p>;
}

export function renderCounter(el: HTMLElement, count: () => number, doubled: () => number) {
  return render(() => <Counter count={count()} doubled={doubled()} />, el);
}

export function renderList(el: HTMLElement, rows: () => readonly { id: number; text: string }[]) {
  return render(() => <ul>{<For each={rows()}>{row => <li>{row.text}</li>}</For>}</ul>, el);
}
