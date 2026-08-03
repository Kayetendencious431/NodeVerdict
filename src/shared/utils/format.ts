export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 23);
}

export function truncate(str: string, max = 80): string {
  return str.length <= max ? str : str.slice(0, max) + '...';
}

export function channelColor(channel: string): string {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) {
    hash = ((hash << 5) - hash) + channel.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export function eventTypeColor(type: string): string {
  switch (type) {
    case 'start': return 'text-emerald-600 bg-emerald-50';
    case 'end': return 'text-blue-600 bg-blue-50';
    case 'asyncStart': return 'text-amber-600 bg-amber-50';
    case 'asyncEnd': return 'text-purple-600 bg-purple-50';
    case 'error': return 'text-red-600 bg-red-50';
    default: return 'text-gray-600 bg-gray-50';
  }
}