export default function Stat({ label, value, accent = "text-ink" }) {
  return (
    <div>
      <div className="text-xs font-medium text-surface-muted">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
