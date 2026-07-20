/* Shared floor-plan renderer. The admin editor and the member map draw from
 * this same component so what staff arrange is exactly what members see.
 * All geometry is real-world centimetres; the SVG viewBox does the scaling. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';
import { mediaUrl } from '../api';

export interface MapPlan {
  id: string;
  name: string;
  widthCm: number;
  heightCm: number;
  gridCm: number;
  backgroundMediaId: string | null;
  backgroundOpacity: string | number;
  entranceXCm: number | null;
  entranceYCm: number | null;
}

export interface MapZone {
  id: string;
  name: string;
  xCm: number | null;
  yCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  color: string;
}

export interface MapUnit {
  unitId: string;
  tagCode: string;
  modelName: string;
  status: string;
  xCm: number;
  yCm: number;
  rotationDeg: number;
  widthCm: number;
  heightCm: number;
}

export interface MapHighlight {
  unitId: string;
  /** 1-based step number for route views; omit for a plain highlight */
  step?: number;
  dimmed?: boolean;
}

const STATUS_FILL: Record<string, string> = {
  in_service: '#ffffff',
  maintenance: '#fdece7',
  out_of_service: '#fdece7',
  retired: '#f0efec',
};
const STATUS_STROKE: Record<string, string> = {
  in_service: '#5B6472',
  maintenance: '#A23B2E',
  out_of_service: '#A23B2E',
  retired: '#c3c2b7',
};

export function FloorMap({
  plan,
  zones,
  units,
  highlights = [],
  selectedUnitId,
  onSelectUnit,
  onCanvasPointerDown,
  interactive = false,
  overlay,
  className,
  fitHeight = 460,
}: {
  plan: MapPlan;
  zones: MapZone[];
  units: MapUnit[];
  highlights?: MapHighlight[];
  selectedUnitId?: string | null;
  onSelectUnit?: (unitId: string) => void;
  onCanvasPointerDown?: (e: React.PointerEvent<SVGSVGElement>, cm: { x: number; y: number }) => void;
  interactive?: boolean;
  overlay?: ReactNode;
  className?: string;
  fitHeight?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: plan.widthCm, h: plan.heightCm });
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // reset the viewport when the plan itself changes size
  useEffect(() => {
    setView({ x: 0, y: 0, w: plan.widthCm, h: plan.heightCm });
  }, [plan.id, plan.widthCm, plan.heightCm]);

  const highlightById = new Map(highlights.map((h) => [h.unitId, h]));
  const anyHighlight = highlights.length > 0;

  /** Convert a client point to plan centimetres. */
  function toCm(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return { x: Math.round(view.x + px * view.w), y: Math.round(view.y + py * view.h) };
  }

  function zoom(factor: number, centerCm?: { x: number; y: number }) {
    setView((v) => {
      const w = Math.min(plan.widthCm * 2, Math.max(200, v.w * factor));
      const h = w * (plan.heightCm / plan.widthCm);
      const cx0 = centerCm?.x ?? v.x + v.w / 2;
      const cy0 = centerCm?.y ?? v.y + v.h / 2;
      return { x: cx0 - (cx0 - v.x) * (w / v.w), y: cy0 - (cy0 - v.y) * (h / v.h), w, h };
    });
  }

  const gridLines: ReactNode[] = [];
  const step = plan.gridCm;
  if (step > 0 && plan.widthCm / step < 400) {
    for (let x = 0; x <= plan.widthCm; x += step) {
      gridLines.push(
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={plan.heightCm} stroke="#e1e0d9" strokeWidth={view.w / 900} />,
      );
    }
    for (let y = 0; y <= plan.heightCm; y += step) {
      gridLines.push(
        <line key={`h${y}`} x1={0} y1={y} x2={plan.widthCm} y2={y} stroke="#e1e0d9" strokeWidth={view.w / 900} />,
      );
    }
  }

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-card', className)}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ height: fitHeight, width: '100%', touchAction: 'none' }}
        role="img"
        aria-label={`Floor plan: ${plan.name}`}
        onPointerDown={(e) => {
          if (onCanvasPointerDown) {
            onCanvasPointerDown(e, toCm(e.clientX, e.clientY));
            if (e.defaultPrevented) return;
          }
          // middle/right or empty-space drag pans the view
          if (e.target === svgRef.current || e.button === 1) {
            panRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const pan = panRef.current;
          if (!pan) return;
          const svg = svgRef.current!;
          const rect = svg.getBoundingClientRect();
          const dx = ((e.clientX - pan.x) / rect.width) * view.w;
          const dy = ((e.clientY - pan.y) / rect.height) * view.h;
          setView((v) => ({ ...v, x: pan.vx - dx, y: pan.vy - dy }));
        }}
        onPointerUp={() => {
          panRef.current = null;
        }}
        onWheel={(e) => {
          if (!interactive) return;
          zoom(e.deltaY > 0 ? 1.15 : 0.87, toCm(e.clientX, e.clientY));
        }}
      >
        {/* floor */}
        <rect x={0} y={0} width={plan.widthCm} height={plan.heightCm} fill="#faf9f7" stroke="#16181D" strokeWidth={view.w / 300} />

        {plan.backgroundMediaId && (
          <image
            href={mediaUrl(plan.backgroundMediaId)}
            x={0}
            y={0}
            width={plan.widthCm}
            height={plan.heightCm}
            opacity={Number(plan.backgroundOpacity)}
            preserveAspectRatio="none"
          />
        )}

        <g>{gridLines}</g>

        {/* zones sit under the machines */}
        {zones.map((z) =>
          z.xCm == null || z.yCm == null || z.widthCm == null || z.heightCm == null ? null : (
            <g key={z.id}>
              <rect
                x={z.xCm}
                y={z.yCm}
                width={z.widthCm}
                height={z.heightCm}
                fill={z.color}
                fillOpacity={0.1}
                stroke={z.color}
                strokeOpacity={0.5}
                strokeWidth={view.w / 500}
                strokeDasharray={`${view.w / 120} ${view.w / 200}`}
              />
              <text
                x={z.xCm + 20}
                y={z.yCm + Math.min(90, z.heightCm / 4)}
                fill={z.color}
                fontSize={Math.max(40, view.w / 42)}
                fontWeight={700}
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                {z.name}
              </text>
            </g>
          ),
        )}

        {plan.entranceXCm != null && plan.entranceYCm != null && (
          <g>
            <circle cx={plan.entranceXCm} cy={plan.entranceYCm} r={view.w / 60} fill="#1F7A4D" />
            <text
              x={plan.entranceXCm}
              y={plan.entranceYCm - view.w / 40}
              textAnchor="middle"
              fontSize={Math.max(36, view.w / 48)}
              fontWeight={700}
              fill="#1F7A4D"
            >
              ENTRANCE
            </text>
          </g>
        )}

        {/* machines */}
        {units.map((u) => {
          const hl = highlightById.get(u.unitId);
          const dim = anyHighlight && !hl;
          const selected = selectedUnitId === u.unitId;
          const labelSize = Math.max(28, view.w / 70);
          return (
            <g
              key={u.unitId}
              transform={`translate(${u.xCm} ${u.yCm}) rotate(${u.rotationDeg})`}
              opacity={dim ? 0.28 : 1}
              style={{ cursor: onSelectUnit ? 'pointer' : 'default' }}
              onPointerDown={(e) => {
                if (!onSelectUnit) return;
                e.stopPropagation();
                onSelectUnit(u.unitId);
              }}
            >
              <rect
                x={-u.widthCm / 2}
                y={-u.heightCm / 2}
                width={u.widthCm}
                height={u.heightCm}
                rx={12}
                fill={hl ? 'var(--brand)' : (STATUS_FILL[u.status] ?? '#fff')}
                fillOpacity={hl ? 0.18 : 1}
                stroke={hl ? 'var(--brand)' : selected ? '#16181D' : (STATUS_STROKE[u.status] ?? '#5B6472')}
                strokeWidth={(hl || selected ? 3.5 : 1.5) * (view.w / 900)}
              />
              {/* a nose mark so rotation is legible */}
              <line
                x1={0}
                y1={-u.heightCm / 2}
                x2={0}
                y2={-u.heightCm / 2 + Math.min(30, u.heightCm / 6)}
                stroke={hl ? 'var(--brand)' : '#5B6472'}
                strokeWidth={3 * (view.w / 900)}
              />
              <text
                x={0}
                y={labelSize / 3}
                textAnchor="middle"
                fontSize={labelSize}
                fontWeight={600}
                fill="#16181D"
                transform={`rotate(${-u.rotationDeg})`}
              >
                {u.modelName.length > 18 ? `${u.modelName.slice(0, 17)}…` : u.modelName}
              </text>
              {hl?.step != null && (
                <g transform={`rotate(${-u.rotationDeg}) translate(0 ${-u.heightCm / 2 - view.w / 55})`}>
                  <circle r={view.w / 50} fill="var(--brand)" />
                  <text
                    textAnchor="middle"
                    y={view.w / 140}
                    fontSize={view.w / 45}
                    fontWeight={800}
                    fill="var(--brand-ink)"
                  >
                    {hl.step}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          className="h-9 w-9 rounded-lg border border-line bg-card text-lg font-bold shadow-sm"
          onClick={() => zoom(0.8)}
          aria-label="Zoom in"
        >
          ＋
        </button>
        <button
          className="h-9 w-9 rounded-lg border border-line bg-card text-lg font-bold shadow-sm"
          onClick={() => zoom(1.25)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="h-9 rounded-lg border border-line bg-card px-2 text-xs font-semibold shadow-sm"
          onClick={() => setView({ x: 0, y: 0, w: plan.widthCm, h: plan.heightCm })}
        >
          Fit
        </button>
      </div>
      {overlay}
    </div>
  );
}

export const metresLabel = (cm: number) => `${(cm / 100).toFixed(1)}m`;
