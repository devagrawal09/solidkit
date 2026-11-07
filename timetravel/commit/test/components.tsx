import { Loading } from "solid-js";
import { render } from "@solidjs/web";

/** S3: a component showing a recorded signal and a memo over it. */
function Counter(props: { count: number; doubled: number }) {
  return (
    <p>
      <span>{props.count}</span>/<span>{props.doubled}</span>
    </p>
  );
}

export function mountCounter(el: HTMLElement, count: () => number, doubled: () => number): () => void {
  return render(() => <Counter count={count()} doubled={doubled()} />, el);
}

/** Extra S8 run: renders an async result under a Loading boundary. */
export function mountResult(el: HTMLElement, result: () => string): () => void {
  return render(
    () => (
      <Loading fallback="loading">
        <span>{result()}</span>
      </Loading>
    ),
    el
  );
}
