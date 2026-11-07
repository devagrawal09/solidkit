// In-page fiber event log — the demo's "network tab". Entries are emitted from
// inside Effect programs (Effect.sync / finalizers), which run on Effect's
// scheduler outside any Solid transaction.
//
// Port: the original kept a module-level store here. In the messages variant
// the log is client state: the program subscribes to these entries (see
// fiberLog in app.ts) and each one arrives as a Logged message, so the kernel
// snapshots the log and rewinding shows it as it was.

export type LogKind = "start" | "success" | "retry" | "interrupt" | "compensate" | "error";

export interface LogEntry {
  id: number;
  time: string;
  kind: LogKind;
  message: string;
}

let nextId = 0;
const start = performance.now();
const listeners = new Set<(entry: LogEntry) => void>();

export function log(kind: LogKind, message: string) {
  const time = ((performance.now() - start) / 1000).toFixed(2) + "s";
  const entry: LogEntry = { id: nextId++, time, kind, message };
  for (const listener of listeners) listener(entry);
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
