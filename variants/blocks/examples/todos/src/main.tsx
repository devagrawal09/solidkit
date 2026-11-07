import { render } from "@solidjs/web";
import { run } from "@solidkit/blocks";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { api } from "./api.ts";
import { App } from "./app.tsx";
import "./app.css";

const kernel = createKernel();

render(() => {
  const app = run(App, { kernel, services: { api }, args: { hash: location.hash } });
  return (
    <>
      <app.View />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
