import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { SearchConfigLive } from "./api";
import { App } from "./app";
import { Shop } from "./shop";
import "./app.css";

const kernel = createKernel();

render(() => {
  const shop = Shop.create(kernel, SearchConfigLive);
  return (
    <>
      <App shop={shop} />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
