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
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Channels:</span>
      <button
        onClick={selectAll}
        className={`text-xs px-2 py-1 rounded-full transition-colors ${selected.length === channels.length ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
      >
        All
      </button>
      <button
        onClick={deselectAll}
        className={`text-xs px-2 py-1 rounded-full transition-colors ${selected.length === 0 ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
      >
        None
      </button>
      {channels.map(ch => (
        <button
          key={ch}
          onClick={() => toggle(ch)}
          className={`text-xs px-2.5 py-1 rounded-full transition-all border ${selected.includes(ch) ? 'text-white border-transparent' : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
          style={selected.includes(ch) ? { backgroundColor: channelColor(ch) } : undefined}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}