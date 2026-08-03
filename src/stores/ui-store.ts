import { create } from 'zustand';

type Page = 'home' | 'event-viewer' | 'trace-viewer' | 'validator' | 'heap-analyzer' | 'report';

interface UIState {
  currentPage: Page;
  navigate: (page: Page) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
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
}));