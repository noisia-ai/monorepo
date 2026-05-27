export function RetentionChart({
  curve,
  durationSeconds,
  height = 140,
}: {
  curve: number[];
  durationSeconds: number;
  height?: number;
}) {
  const w = 320;
  const h = height;
  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 24;

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  // x positions for each curve point (10 points → 0%, 11%, 22%, ..., 100% of duration)
  const points = curve.map((y, i) => {
    const x = padL + (innerW * i) / (curve.length - 1);
    const yPx = padT + innerH * (1 - y);
    return { x, y: yPx, value: y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${h - padB} L ${points[0].x} ${h - padB} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg className="db-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Curva de retención">
      <defs>
        <linearGradient id="retentionGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,138,138,0.22)" />
          <stop offset="100%" stopColor="rgba(0,138,138,0)" />
        </linearGradient>
      </defs>

      {/* gridlines */}
      {yTicks.map((t) => {
        const y = padT + innerH * (1 - t);
        return (
          <g key={t}>
            <line className="axis" x1={padL} y1={y} x2={w - padR} y2={y} />
            <text x={padL - 6} y={y + 3} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        );
      })}

      {/* area */}
      <path d={areaPath} fill="url(#retentionGrad)" />

      {/* line */}
      <path
        d={linePath}
        stroke="#008a8a"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.6" fill="#008a8a" />
      ))}

      {/* x labels: 0s, half, full */}
      <text x={padL} y={h - 6} textAnchor="start">
        0s
      </text>
      <text x={padL + innerW / 2} y={h - 6} textAnchor="middle">
        {Math.round(durationSeconds / 2)}s
      </text>
      <text x={w - padR} y={h - 6} textAnchor="end">
        {Math.round(durationSeconds)}s
      </text>
    </svg>
  );
}
