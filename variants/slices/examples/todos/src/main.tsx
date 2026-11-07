import { render } from "@solidjs/web";
import { createKernel } from "@solidkit/kernel";
import { Devtools } from "@solidkit/kernel/devtools";
import { api } from "./api";
import { App } from "./app";
import { Todos } from "./todos";
import "./app.css";

const kernel = createKernel();

render(() => {
  const todos = Todos.create(kernel, api, location.hash);
  return (
    <>
      <App todos={todos} />
      <Devtools kernel={kernel} />
    </>
  );
}, document.getElementById("app")!);
