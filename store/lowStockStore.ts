import { create } from 'zustand';
import * as lowStockService from '../services/lowStock';
import type { LowStockFlag } from '../services/lowStock';

interface LowStockState {
  flags: LowStockFlag[];
  loading: boolean;
  error: string | null;
  fetchFlags: () => Promise<void>;
  addFlag: (name: string) => Promise<void>;
  deleteFlag: (flagId: string) => Promise<void>;
}

export const useLowStockStore = create<LowStockState>((set, get) => ({
  flags: [],
  loading: false,
  error: null,

  async fetchFlags() {
    set({ loading: true, error: null });
    try {
      const flags = await lowStockService.getFlags();
      set({ flags, loading: false });
    } catch (err: any) {
      const status = err?.response?.status;
      let message = 'Failed to load flags. Check your connection.';
      if (status === 401) message = 'Session expired. Please log in again.';
      else if (status === 403) message = 'You are not assigned to a household yet.';
      set({ error: message, loading: false });
    }
  },

  async addFlag(name) {
    const flag = await lowStockService.addFlag(name);
    set((state) => ({ flags: [flag, ...state.flags] }));
  },

  async deleteFlag(flagId) {
    const prev = get().flags;
    set((state) => ({ flags: state.flags.filter((f) => f.id !== flagId) }));
    try {
      await lowStockService.deleteFlag(flagId);
    } catch (err) {
      set({ flags: prev });
      throw err;
    }
  },

}))
;
