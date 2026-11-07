import { render } from "@solidjs/web";

function Counter(props: { count: number; doubled: number }) {
  // One string child: happy-dom mishandles a bare numeric text node.
  return <p>{`count=${props.count} doubled=${props.doubled}`}</p>;
}

export function renderCounter(el: HTMLElement, count: () => number, doubled: () => number) {
  return render(() => <Counter count={count()} doubled={doubled()} />, el);
}
