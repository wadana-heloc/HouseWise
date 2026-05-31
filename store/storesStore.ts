import { create } from 'zustand';
import * as storesService from '../services/stores';
import type { Store } from '../services/stores';

interface StoresState {
  stores: Store[];
  loading: boolean;
  error: string | null;
  fetchStores: () => Promise<void>;
  addStore: (name: string, url: string) => Promise<void>;
  deleteStore: (storeId: string) => Promise<void>;
}

export const useStoresStore = create<StoresState>((set, get) => ({
  stores: [],
  loading: false,
  error: null,

  async fetchStores() {
    set({ loading: true, error: null });
    try {
      const stores = await storesService.listStores();
      set({ stores, loading: false });
    } catch (err: any) {
      const status = err?.response?.status;
      let message = 'Failed to load stores. Check your connection.';
      if (status === 401) message = 'Session expired. Please log in again.';
      else if (status === 403) message = 'You are not assigned to a household yet.';
      set({ error: message, loading: false });
    }
  },

  async addStore(name, url) {
    const store = await storesService.addStore(name, url);
    set((state) => ({ stores: [...state.stores, store].sort((a, b) => a.name.localeCompare(b.name)) }));
  },

  async deleteStore(storeId) {
    const prev = get().stores;
    set((state) => ({ stores: state.stores.filter((s) => s.id !== storeId) }));
    try {
      await storesService.deleteStore(storeId);
    } catch (err) {
      set({ stores: prev });
      throw err;
    }
  },
}));
