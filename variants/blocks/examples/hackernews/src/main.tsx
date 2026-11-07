import { render } from "@solidjs/web";
import { run } from "@solidkit/blocks";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { hn } from "./hn.ts";
import { Shell } from "./shell.tsx";
import "./app.css";

const kernel = createKernel();

render(() => {
  const app = run(Shell, { kernel, services: { hn }, args: { href: location.pathname + location.search } });
  return (
    <>
      <app.View />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
