const COLORS: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800',
  SEARCHING: 'bg-blue-100 text-blue-800',
  ASSIGNED: 'bg-emerald-100 text-emerald-800',
  TIMEOUT: 'bg-red-100 text-red-800',
  AVAILABLE: 'bg-emerald-100 text-emerald-800',
  BUSY: 'bg-amber-100 text-amber-800',
  OFFLINE: 'bg-neutral-200 text-neutral-600',
};

export default function Badge({ label }: { label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        COLORS[label] ?? 'bg-neutral-200 text-neutral-700'
      }`}
    >
      {label}
    </span>
  );
}
