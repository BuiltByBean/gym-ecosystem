/* Chart kit per the dataviz method: fixed validated palette (never the gym's
 * brand hue — identity must survive re-branding), thin marks, hairline grid,
 * tooltips by default, table fallback for accessibility. */
import { useMemo, useState } from 'react';

// Validated categorical slots (fixed order — never cycled) + chrome inks.
export const SERIES = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'] as const;
const DATA_HUE = '#2a78d6'; // single-hue magnitude
const GRID = '#e1e0d9';
const MUTED = '#898781';

/** Horizontal magnitude bars — one measure across entities, one hue, direct labels. */
export function HBarList({ rows, unit }: { rows: { label: string; value: number; sub?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${r.value}${unit ? ` ${unit}` : ''}`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="truncate font-medium">{r.label}</span>
            <span className="score text-sm">{r.value}{r.sub && <span className="ml-1 text-xs font-normal text-steel">{r.sub}</span>}</span>
          </div>
          <div className="h-2.5 rounded-[4px]" style={{ background: GRID }}>
            <div
              className="h-2.5 rounded-[4px]"
              style={{ width: `${(r.value / max) * 100}%`, background: DATA_HUE, minWidth: r.value > 0 ? 4 : 0 }}
            />
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-steel">No data yet.</p>}
    </div>
  );
}

/** Progress-against-capacity rows (utilization): value bar on a capacity track. */
export function UtilBars({ rows }: { rows: { label: string; value: number; capacity: number }[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = r.capacity > 0 ? Math.min(100, Math.round((r.value / r.capacity) * 100)) : 0;
        return (
          <div key={r.label} title={`${r.label}: ${Math.round(r.value / 60)}h of ${Math.round(r.capacity / 60)}h (${pct}%)`}>
            <div className="mb-0.5 flex items-baseline justify-between text-[13px]">
              <span className="truncate font-medium">{r.label}</span>
              <span className="score text-sm">{pct}%</span>
            </div>
            <div className="h-2.5 rounded-[4px]" style={{ background: GRID }}>
              <div className="h-2.5 rounded-[4px]" style={{ width: `${pct}%`, background: DATA_HUE, minWidth: r.value > 0 ? 4 : 0 }} />
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-steel">No trainers with availability yet.</p>}
    </div>
  );
}

interface Pt {
  x: number; // index
  label: string;
  y: number;
}

/** Single-series line: 2px line, markers, hover tooltip. Title names the series — no legend. */
export function LineChart({ points, height = 160, format }: { points: { label: string; value: number }[]; height?: number; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const P = { t: 10, r: 12, b: 22, l: 40 };
  const fmt = format ?? ((v: number) => String(Math.round(v)));

  const pts: Pt[] = points.map((p, i) => ({ x: i, label: p.label, y: p.value }));
  const { path, coords, min, max } = useMemo(() => {
    if (pts.length === 0) return { path: '', coords: [] as { cx: number; cy: number }[], min: 0, max: 1 };
    const ys = pts.map((p) => p.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
    const min = Math.max(0, lo - pad);
    const max = hi + pad;
    const cw = W - P.l - P.r;
    const ch = height - P.t - P.b;
    const coords = pts.map((p) => ({
      cx: P.l + (pts.length === 1 ? cw / 2 : (p.x / (pts.length - 1)) * cw),
      cy: P.t + ch - ((p.y - min) / (max - min)) * ch,
    }));
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
    return { path, coords, min, max };
  }, [points, height]);

  if (pts.length === 0) return <p className="text-sm text-steel">Nothing logged yet.</p>;
  const h = hover != null ? pts[hover] : null;
  const hc = hover != null ? coords[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Trend from ${pts[0]!.label} to ${pts[pts.length - 1]!.label}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          let bestD = Infinity;
          coords.forEach((c, i) => {
            const d = Math.abs(c.cx - x);
            if (d < bestD) { bestD = d; best = i; }
          });
          setHover(best);
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = P.t + (height - P.t - P.b) * (1 - f);
          return <line key={f} x1={P.l} x2={W - P.r} y1={y} y2={y} stroke={GRID} strokeWidth={1} />;
        })}
        <line x1={P.l} x2={W - P.r} y1={height - P.b} y2={height - P.b} stroke="#c3c2b7" strokeWidth={1} />
        <text x={P.l - 6} y={P.t + 8} textAnchor="end" fontSize={11} fill={MUTED}>{fmt(max)}</text>
        <text x={P.l - 6} y={height - P.b} textAnchor="end" fontSize={11} fill={MUTED}>{fmt(min)}</text>
        <text x={P.l} y={height - 6} fontSize={11} fill={MUTED}>{pts[0]!.label}</text>
        <text x={W - P.r} y={height - 6} textAnchor="end" fontSize={11} fill={MUTED}>{pts[pts.length - 1]!.label}</text>
        {hc && <line x1={hc.cx} x2={hc.cx} y1={P.t} y2={height - P.b} stroke={MUTED} strokeWidth={1} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke={DATA_HUE} strokeWidth={2} strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={hover === i ? 5 : 3.5} fill={DATA_HUE} stroke="#fff" strokeWidth={2} />
        ))}
      </svg>
      {h && hc && (
        <div
          className="pointer-events-none absolute rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white"
          style={{ left: `${(hc.cx / W) * 100}%`, top: 0, transform: 'translateX(-50%)' }}
        >
          {h.label}: {fmt(h.y)}
        </div>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-steel">Data table</summary>
        <table className="mt-1 text-xs text-steel">
          <tbody>
            {pts.map((p) => (
              <tr key={p.x}><td className="pr-3">{p.label}</td><td className="score">{fmt(p.y)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Weekly stacked bars by category — fixed slot order, 2px surface gaps, legend + tooltip. */
export function StackedWeeklyBars({
  weeks,
  categories,
  format,
}: {
  weeks: { label: string; values: Record<string, number> }[];
  categories: string[];
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const totals = weeks.map((w) => categories.reduce((s, c) => s + (w.values[c] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 150 }} role="img" aria-label="Weekly volume by category">
        {weeks.map((w, i) => (
          <div key={w.label} className="flex min-w-0 flex-1 flex-col justify-end self-stretch" title={`${w.label}: ${fmt(totals[i]!)}`}>
            <div className="flex flex-col-reverse overflow-hidden rounded-t-[4px]">
              {categories.map((c, ci) =>
                (w.values[c] ?? 0) > 0 ? (
                  <div
                    key={c}
                    title={`${c}: ${fmt(w.values[c]!)}`}
                    style={{
                      height: Math.max(3, ((w.values[c] ?? 0) / max) * 132),
                      background: SERIES[ci % SERIES.length],
                      borderTop: '2px solid var(--color-card)',
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-1 truncate text-center text-[10px] text-steel">{w.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {categories.map((c, ci) => (
          <span key={c} className="flex items-center gap-1.5 text-xs font-medium">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[ci % SERIES.length] }} />
            {c}
          </span>
        ))}
      </div>
      {weeks.length === 0 && <p className="text-sm text-steel">No volume logged yet.</p>}
    </div>
  );
}
