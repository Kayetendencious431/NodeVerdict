import { channelColor } from '../utils';

interface ChannelFilterProps {
  channels: string[];
  selected: string[];
  onChange: (channels: string[]) => void;
}

export function ChannelFilter({ channels, selected, onChange }: ChannelFilterProps) {
  const toggle = (ch: string) => {
    if (selected.includes(ch)) {
      if (selected.length > 1) onChange(selected.filter(s => s !== ch));
    } else {
      onChange([...selected, ch]);
    }
  };

  const selectAll = () => onChange([...channels]);
  const deselectAll = () => onChange([]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-gray-500 mr-1">Channels:</span>
      <button
        onClick={selectAll}
        className={`text-xs px-2 py-1 rounded-full transition-colors ${selected.length === channels.length ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
      >
        All
      </button>
      <button
        onClick={deselectAll}
        className={`text-xs px-2 py-1 rounded-full transition-colors ${selected.length === 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
      >
        None
      </button>
      {channels.map(ch => (
        <button
          key={ch}
          onClick={() => toggle(ch)}
          className={`text-xs px-2.5 py-1 rounded-full transition-all border ${selected.includes(ch) ? 'text-white border-transparent' : 'text-gray-600 border-gray-200 hover:border-gray-300'}`}
          style={selected.includes(ch) ? { backgroundColor: channelColor(ch) } : undefined}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}