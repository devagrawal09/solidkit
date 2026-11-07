import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { App } from "./app";
import { hn } from "./hn";
import { News } from "./news";
import { parse } from "./routes";
import "./app.css";

const kernel = createKernel();

render(() => {
  const news = News.create(kernel, hn, parse(location.href));
  return (
    <>
      <App news={news} />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
