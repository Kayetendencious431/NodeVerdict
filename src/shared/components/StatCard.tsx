interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export function StatCard({ title, value, subtitle, color = 'text-gray-900' }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}