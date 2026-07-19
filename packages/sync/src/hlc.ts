/** Hybrid logical clock, encoded as a lexicographically sortable string:
 *  `<13-digit ms>-<4-hex counter>-<node>`. Compare with plain string compare. */

export interface Hlc {
  ms: number;
  count: number;
  node: string;
}

export function hlcEncode(h: Hlc): string {
  return `${String(h.ms).padStart(13, '0')}-${h.count.toString(16).padStart(4, '0')}-${h.node}`;
}

export function hlcParse(s: string): Hlc {
  const ms = Number(s.slice(0, 13));
  const count = parseInt(s.slice(14, 18), 16);
  const node = s.slice(19);
  return { ms, count, node };
}

export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Per-device clock. `tick()` for local events; `receive()` folds in a remote stamp. */
export function createHlcClock(node: string, now: () => number = Date.now) {
  let last: Hlc = { ms: 0, count: 0, node };

  return {
    tick(): string {
      const wall = now();
      if (wall > last.ms) last = { ms: wall, count: 0, node };
      else last = { ms: last.ms, count: last.count + 1, node };
      return hlcEncode(last);
    },
    receive(remote: string): string {
      const r = hlcParse(remote);
      const wall = now();
      const ms = Math.max(wall, last.ms, r.ms);
      let count: number;
      if (ms === last.ms && ms === r.ms) count = Math.max(last.count, r.count) + 1;
      else if (ms === last.ms) count = last.count + 1;
      else if (ms === r.ms) count = r.count + 1;
      else count = 0;
      last = { ms, count, node };
      return hlcEncode(last);
    },
    current(): string {
      return hlcEncode(last);
    },
  };
}
