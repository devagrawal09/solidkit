// The demo's "network tab", now an event source. Effect programs call log()
// from Effect.sync and finalizers, exactly as before; the EventLog block
// subscribes and turns every entry into a message, so the log lives in the
// app's store (time travel restores it) and each fiber event is on the
// devtools timeline.

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
  const entry = { id: nextId++, time, kind, message };
  for (const listener of listeners) listener(entry);
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
