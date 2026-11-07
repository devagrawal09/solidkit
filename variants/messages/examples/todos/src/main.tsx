import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { api } from "./api.ts";
import { App } from "./view.tsx";

const kernel = createKernel();

render(
  () => (
    <>
      <App kernel={kernel} services={{ api }} flags={location.hash} />
      <Devtools kernel={kernel} />
    </>
  ),
  document.getElementById("app")!
);
