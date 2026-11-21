import { create } from 'zustand';
import type { ScreenId } from '@casino/shared';

export interface NavState {
  screen: ScreenId;
  go: (screen: ScreenId) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  screen: 'home',
  go: (screen) => set({ screen }),
}));
