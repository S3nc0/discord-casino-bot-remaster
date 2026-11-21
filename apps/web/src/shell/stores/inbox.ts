import { create } from 'zustand';
import type { InboxItem } from '@casino/shared';

export interface InboxState {
  /** Newest first. */
  items: InboxItem[];
  /** Unread items in this guild in total (the server's count, not just the loaded page). */
  unread: number;
  loaded: boolean;
  set: (items: InboxItem[], unread: number) => void;
  add: (item: InboxItem) => void;
  setUnread: (unread: number) => void;
  markRead: (ids: number[], at: number) => void;
  markAllRead: (at: number) => void;
  reset: () => void;
}

const newestFirst = (a: InboxItem, b: InboxItem) => b.createdAt - a.createdAt || b.id - a.id;

export const useInboxStore = create<InboxState>()((set) => ({
  items: [],
  unread: 0,
  loaded: false,
  set: (items, unread) => set({ items: [...items].sort(newestFirst), unread, loaded: true }),
  add: (item) =>
    set((s) =>
      s.items.some((i) => i.id === item.id)
        ? s
        : {
            items: [item, ...s.items].sort(newestFirst),
            unread: item.readAt === null ? s.unread + 1 : s.unread,
          },
    ),
  setUnread: (unread) => set({ unread }),
  markRead: (ids, at) =>
    set((s) => {
      const flipped = s.items.filter((i) => ids.includes(i.id) && i.readAt === null).length;
      return {
        items: s.items.map((i) =>
          ids.includes(i.id) && i.readAt === null ? { ...i, readAt: at } : i,
        ),
        unread: Math.max(0, s.unread - flipped),
      };
    }),
  markAllRead: (at) =>
    set((s) => ({
      items: s.items.map((i) => (i.readAt === null ? { ...i, readAt: at } : i)),
      unread: 0,
    })),
  reset: () => set({ items: [], unread: 0, loaded: false }),
}));

export const selectUnread = (s: Pick<InboxState, 'unread'>): number => s.unread;
