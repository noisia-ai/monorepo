import { formatCount } from "@/lib/dashboards/grupo-salinas";

type Datum = { label: string; value: number };

export function BrandsBarChart({ data, height = 180 }: { data: Datum[]; height?: number }) {
  const w = 520;
  const h = height;
  const padL = 56;
  const padR = 14;
  const padT = 14;
  const padB = 20;

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const max = Math.max(...data.map((d) => d.value), 1);
  const barH = innerH / data.length - 8;

  return (
    <svg
      className="db-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Engagement por marca"
      preserveAspectRatio="xMidYMid meet"
    >
      {data.map((d, i) => {
        const y = padT + i * (barH + 8);
        const widthVal = (d.value / max) * innerW;
        return (
          <g key={d.label}>
            <text x={padL - 8} y={y + barH / 2 + 4} textAnchor="end" style={{ fontSize: 11 }}>
              {d.label}
            </text>
            <rect
              x={padL}
              y={y}
              width={Math.max(2, widthVal)}
              height={barH}
              rx={4}
              fill="#0a0a0a"
              opacity={0.85}
              className="bar"
            />
            <text x={padL + widthVal + 6} y={y + barH / 2 + 4} style={{ fontSize: 11, fill: "#2b2b2b" }}>
              {formatCount(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
