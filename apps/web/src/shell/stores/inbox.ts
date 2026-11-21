import { create } from 'zustand';
import type { InboxItem } from '@casino/shared';

export interface InboxState {
  /** Newest first. */
  items: InboxItem[];
  loaded: boolean;
  set: (items: InboxItem[]) => void;
  add: (item: InboxItem) => void;
  markRead: (ids: number[], at: number) => void;
  reset: () => void;
}

const newestFirst = (a: InboxItem, b: InboxItem) => b.createdAt - a.createdAt || b.id - a.id;

export const useInboxStore = create<InboxState>()((set) => ({
  items: [],
  loaded: false,
  set: (items) => set({ items: [...items].sort(newestFirst), loaded: true }),
  add: (item) =>
    set((s) =>
      s.items.some((i) => i.id === item.id) ? s : { items: [item, ...s.items].sort(newestFirst) },
    ),
  markRead: (ids, at) =>
    set((s) => ({
      items: s.items.map((i) =>
        ids.includes(i.id) && i.readAt === null ? { ...i, readAt: at } : i,
      ),
    })),
  reset: () => set({ items: [], loaded: false }),
}));

export const selectUnread = (s: Pick<InboxState, 'items'>): number =>
  s.items.reduce((n, i) => (i.readAt === null ? n + 1 : n), 0);
