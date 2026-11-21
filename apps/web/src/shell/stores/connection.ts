import { create } from 'zustand';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Reconnect attempts since the last successful connect. */
  attempt: number;
  setStatus: (status: ConnectionStatus) => void;
  attempted: (attempt: number) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: 'offline',
  attempt: 0,
  setStatus: (status) => set(status === 'online' ? { status, attempt: 0 } : { status }),
  attempted: (attempt) => set({ attempt, status: 'reconnecting' }),
}));
