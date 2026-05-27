const counters = [
  { value: 150, suffix: "+", label: "fuentes" },
  { value: 10000, suffix: "+", label: "capturas posibles" },
  { value: 45, suffix: "+", label: "mercados" },
  { value: 8, suffix: "+", label: "categorías" }
];

function CounterItem({ value, suffix, label }: (typeof counters)[0]) {
  return (
    <div className="arch-counter-item">
      <strong>
        {value.toLocaleString()}
        {suffix}
      </strong>
      <span>{label}</span>
    </div>
  );
}

export function ArchitectureCounters() {
  return (
    <div className="arch-counter-strip" aria-label="Métricas de arquitectura">
      {counters.map((c) => (
        <CounterItem key={c.label} {...c} />
      ))}
    </div>
  );
}
