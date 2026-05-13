export function EvolutionChart({
  viewsByDay,
  height = 140,
}: {
  viewsByDay: number[];
  height?: number;
}) {
  const w = 320;
  const h = height;
  const padL = 36;
  const padR = 10;
  const padT = 12;
  const padB = 22;

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxVal = Math.max(...viewsByDay, 1);
  const days = viewsByDay.length;

  const points = viewsByDay.map((v, i) => ({
    x: padL + (innerW * i) / Math.max(1, days - 1),
    y: padT + innerH * (1 - v / maxVal),
    value: v,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : `${n}`;

  return (
    <svg className="db-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Evolución de views por día">
      <defs>
        <linearGradient id="evolGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(15,15,18,0.18)" />
          <stop offset="100%" stopColor="rgba(15,15,18,0)" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      {[0, 0.5, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        return (
          <g key={t}>
            <line className="axis" x1={padL} y1={y} x2={w - padR} y2={y} />
            <text x={padL - 6} y={y + 3} textAnchor="end">
              {fmt(maxVal * t)}
            </text>
          </g>
        );
      })}

      {/* area */}
      <path d={`${linePath} L ${points[points.length - 1].x} ${h - padB} L ${points[0].x} ${h - padB} Z`} fill="url(#evolGrad)" />

      {/* line */}
      <path
        d={linePath}
        stroke="#0a0a0a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* labels */}
      <text x={padL} y={h - 4} textAnchor="start">
        D0
      </text>
      <text x={padL + innerW / 2} y={h - 4} textAnchor="middle">
        D{Math.floor(days / 2)}
      </text>
      <text x={w - padR} y={h - 4} textAnchor="end">
        D{days - 1}
      </text>
    </svg>
  );
}
