import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** Stored as a message key + params so a language switch re-renders the text. */
export interface ToastEntry {
  id: number;
  tone: ToastTone;
  messageKey: string;
  params?: Record<string, string | number> | undefined;
}

const MAX_VISIBLE = 4;

export interface ToastState {
  toasts: ToastEntry[];
  nextId: number;
  push: (toast: Omit<ToastEntry, 'id'>) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  nextId: 1,
  push: (toast) => {
    const id = get().nextId;
    set((s) => ({ nextId: id + 1, toasts: [...s.toasts, { ...toast, id }].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
