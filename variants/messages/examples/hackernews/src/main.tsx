import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { hn, nav } from "./hn.ts";
import { App } from "./view.tsx";
import "./app.css";

const kernel = createKernel();

render(
  () => (
    <>
      <App kernel={kernel} services={{ hn, nav }} flags={location.href} />
      <Devtools kernel={kernel} />
    </>
  ),
  document.getElementById("app")!
);
