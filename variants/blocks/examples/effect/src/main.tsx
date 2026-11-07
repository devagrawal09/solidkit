import { render } from "@solidjs/web";
import { run } from "@solidkit/blocks";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { SearchConfigLive } from "./api.ts";
import { App } from "./app.tsx";
import { createServices } from "./services.ts";
import { createRuntime, RuntimeContext } from "./solid-effect.ts";
import "./app.css";

const kernel = createKernel();

// Inside <RuntimeContext>, so runEffect and effectAction resolve the runtime
// that provides SearchConfig (Effect's R channel riding Solid's owner tree).
function Main() {
  const app = run(App, { kernel, services: createServices() });
  return <app.View />;
}

render(
  () => (
    <>
      <RuntimeContext value={createRuntime(SearchConfigLive)}>
        <Main />
      </RuntimeContext>
      <Devtools kernel={kernel} />
    </>
  ),
  document.getElementById("app")!
);
