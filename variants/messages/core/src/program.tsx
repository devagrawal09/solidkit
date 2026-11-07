import { untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Kernel } from "@solidkit/kernel";
import { createProgram, type Program, type ProgramSpec, type Send, type Tagged } from "./index.ts";

export type View<Model, Msg, Data> = (model: Model, send: Send<Msg>, data: Data) => JSX.Element;

export type ProgramProps<Services, Flags> = { kernel: Kernel; services: Services } & (Flags extends void
  ? { flags?: Flags }
  : { flags: Flags });

/**
 * A component that owns a program and renders its view. While the kernel is rewound
 * the view is inert: the page is a picture of the past, so clicks and typing can't
 * make the DOM drift from the restored state (send also drops input via kernel.live).
 */
export function program<Model extends object, Msg extends Tagged, Act extends Tagged, Data, Services extends object, Flags = void>(
  spec: ProgramSpec<Model, Msg, Act, Data, Services, Flags> & { view: View<Model, Msg, Data> }
) {
  return (props: ProgramProps<Services, Flags>): JSX.Element => {
    // flags is optional in the props only when Flags is void, so undefined is a Flags there.
    const app = untrack(() =>
      createProgram(spec, { kernel: props.kernel, services: props.services, flags: props.flags as Flags })
    );
    return renderView(app, spec.view);
  };
}

/** A program's view, inert while the kernel is rewound. Used by program() and scenario(). */
export function renderView<Model, Msg, Data>(app: Program<Model, Msg, Data>, view: View<Model, Msg, Data>): JSX.Element {
  return (
    <div style={{ display: "contents" }} inert={app.kernel.travelingAt() !== null}>
      {view(app.model, app.send, app.data)}
    </div>
  );
}
