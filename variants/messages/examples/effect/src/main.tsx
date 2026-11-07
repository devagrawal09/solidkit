import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { SearchConfigLive } from "./api.ts";
import { createServices } from "./services.ts";
import { createRuntime } from "./solid-effect.ts";
import { App } from "./view.tsx";

const kernel = createKernel();

render(() => {
  // The Effect runtime (SearchConfig, the R channel) lives as long as this root.
  const runtime = createRuntime(SearchConfigLive);
  return (
    <>
      <App kernel={kernel} services={createServices(runtime)} />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
