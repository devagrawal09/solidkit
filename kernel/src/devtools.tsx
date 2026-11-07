// A minimal in-page devtools panel: timeline, entry details, state at any
// entry, rewind/resume, and session export. Also installs window.__solidkit
// so agents (or a browser MCP) can read the timeline and drive time travel.
import { createSignal, For, onSettled, Show } from "solid-js";
import type { Entry, Kernel } from "./index.ts";

function label(e: Entry): string {
  switch (e.kind) {
    case "transition":
      return `${e.source} · ${e.name}`;
    case "action":
      return `action ${e.name} ${e.phase}${e.error ? ": " + e.error : ""}`;
    case "service":
      return `${e.replayed ? "replay " : ""}${e.path} ${e.phase}${e.error ? ": " + e.error : ""}`;
    case "note":
      return e.text;
  }
}

const colors: Record<Entry["kind"], string> = {
  transition: "#9cdcfe",
  action: "#c586c0",
  service: "#4ec9b0",
  note: "#999"
};

export function installGlobal(kernel: Kernel) {
  (globalThis as Record<string, unknown>).__solidkit = {
    entries: () => kernel.entries(),
    stateAt: (seq: number) => kernel.stateAt(seq),
    rewind: (seq: number) => kernel.rewind(seq),
    resume: () => kernel.resume(),
    exportSession: () => kernel.exportSession()
  };
}

export function Devtools(props: { kernel: Kernel }) {
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [kinds, setKinds] = createSignal<Record<string, boolean>>({ transition: true, action: true, service: true, note: false });
  onSettled(() => installGlobal(props.kernel));

  const visible = () => props.kernel.entries().filter(e => kinds()[e.kind]);
  const entry = () => props.kernel.entries().find(e => e.seq === selected());
  const download = () => {
    const blob = new Blob([props.kernel.exportSession()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "solidkit-session.json";
    a.click();
  };

  return (
    <div style={{ position: "fixed", right: "12px", bottom: "12px", "z-index": "2147483647", font: "12px/1.4 ui-monospace, monospace" }}>
      <Show
        when={open()}
        fallback={
          <button onClick={() => setOpen(true)} style={{ padding: "6px 10px", background: "#1e1e1e", color: "#ddd", border: "1px solid #444", "border-radius": "6px" }}>
            solid-kit · {props.kernel.entries().length}
            {props.kernel.travelingAt() !== null ? " · rewound" : ""}
          </button>
        }
      >
        <div style={{ width: "640px", height: "380px", display: "flex", "flex-direction": "column", background: "#1e1e1e", color: "#ddd", border: "1px solid #444", "border-radius": "6px", overflow: "hidden" }}>
          <header style={{ display: "flex", gap: "8px", padding: "6px 8px", "border-bottom": "1px solid #333", "align-items": "center" }}>
            <strong>solid-kit</strong>
            <For each={["transition", "action", "service", "note"] as const}>
              {kind => (
                <label style={{ color: colors[kind] }}>
                  <input type="checkbox" checked={kinds()[kind]} onChange={e => setKinds(k => ({ ...k, [kind]: e.currentTarget.checked }))} /> {kind}
                </label>
              )}
            </For>
            <span style={{ flex: "1" }} />
            <Show when={props.kernel.travelingAt() !== null}>
              <span style={{ color: "#f5a623" }}>rewound to #{props.kernel.travelingAt()}</span>
              <button onClick={() => props.kernel.resume()}>resume</button>
            </Show>
            <button onClick={download}>export</button>
            <button onClick={() => setOpen(false)}>×</button>
          </header>
          <div style={{ display: "flex", flex: "1", "min-height": "0" }}>
            <ol style={{ margin: "0", padding: "4px 0", width: "50%", overflow: "auto", "list-style": "none", "border-right": "1px solid #333" }}>
              <For each={visible()}>
                {e => (
                  <li
                    onClick={() => setSelected(e.seq)}
                    style={{ padding: "1px 8px", cursor: "pointer", color: colors[e.kind], background: selected() === e.seq ? "#094771" : "transparent" }}
                  >
                    #{e.seq} {label(e)}
                  </li>
                )}
              </For>
            </ol>
            <div style={{ width: "50%", overflow: "auto", padding: "6px 8px" }}>
              <Show when={entry()} fallback={<p>Select an entry.</p>}>
                {e => (
                  <>
                    <button onClick={() => props.kernel.rewind(e().seq)}>rewind to #{e().seq}</button>
                    <pre style={{ "white-space": "pre-wrap" }}>{JSON.stringify(e(), null, 2)}</pre>
                    <strong>state after #{e().seq}</strong>
                    <pre style={{ "white-space": "pre-wrap" }}>{JSON.stringify(props.kernel.stateAt(e().seq), null, 2)}</pre>
                  </>
                )}
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
