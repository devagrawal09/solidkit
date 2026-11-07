// In-page fiber event log, the demo's "network tab". The entries are client
// state (a slice), so the panel time travels with the rest of the app. api.ts
// calls log() from inside Effect programs, on Effect's scheduler, outside any
// Solid transaction; the app points log() at the mounted slice.
import { slice } from "@solidkit/slices";

export type LogKind = "start" | "success" | "retry" | "interrupt" | "compensate" | "error";

export interface LogEntry {
  id: number;
  time: string;
  kind: LogKind;
  message: string;
}

type LogState = { entries: LogEntry[]; nextId: number };
const initial: LogState = { entries: [], nextId: 0 };

export const logSlice = slice("log", initial, {
  appended(state, kind: LogKind, message: string, time: string) {
    state.entries.push({ id: state.nextId++, time, kind, message });
    if (state.entries.length > 100) state.entries.splice(0, state.entries.length - 100);
  },
  cleared(state) {
    state.entries.length = 0;
  }
});

type Write = (kind: LogKind, message: string, time: string) => void;
const start = performance.now();
let write: Write = () => {};

/** Points log() at a mounted log slice. */
export function logTo(appended: Write) {
  write = appended;
}

export function log(kind: LogKind, message: string) {
  write(kind, message, ((performance.now() - start) / 1000).toFixed(2) + "s");
}
