import { create } from 'zustand';

type Page = 'home' | 'event-viewer' | 'trace-viewer' | 'validator' | 'heap-analyzer' | 'report' | 'cpu-profiler' | 'heap-diff' | 'search-filter' | 'time-series' | 'perf-compare' | 'tutorial' | 'memory-timeline' | 'gc-log';

interface UIState {
  currentPage: Page;
  navigate: (page: Page) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

function getInitialDarkMode(): boolean {
  try {
    const stored = localStorage.getItem('nodeverdict-darkmode');
    if (stored !== null) return stored === 'true';
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const useUIStore = create<UIState>((set) => ({
  currentPage: 'home',
  navigate: (page) => set({ currentPage: page }),
  loading: false,
  setLoading: (loading) => set({ loading }),
  error: null,
  setError: (error) => set({ error }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  darkMode: getInitialDarkMode(),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode;
    try { localStorage.setItem('nodeverdict-darkmode', String(next)); } catch {}
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return { darkMode: next };
  }),
}));