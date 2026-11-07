import { createStore } from "solid-js";
import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";

// Toolchain check only: a counter wired straight to the kernel.
const kernel = createKernel();

function App() {
  const [state, setState] = createStore({ count: 0 });
  kernel.track("counter", state, setState);
  const increment = () => {
    if (!kernel.live("increment")) return;
    setState(s => {
      s.count++;
    });
    kernel.commit("counter", "incremented");
  };
  return (
    <>
      <button onClick={increment}>count: {state.count}</button>
      <Devtools kernel={kernel} />
    </>
  );
}

render(() => <App />, document.getElementById("app")!);
