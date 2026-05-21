import { create } from 'zustand';
import * as itemService from '../services/items';
import type { Item, AddItemParams, ItemStatus } from '../services/items';

interface ItemState {
  items: Item[];
  loading: boolean;
  error: string | null;
  fetchItems: () => Promise<void>;
  addItem: (params: AddItemParams) => Promise<Item>;
  deleteItem: (id: string) => Promise<void>;
  updateStatus: (id: string, status: ItemStatus) => Promise<void>;
}

export const useItemStore = create<ItemState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  async fetchItems() {
    set({ loading: true, error: null });
    try {
      const items = await itemService.getItems();
      set({ items, loading: false });
    } catch (err: any) {
      const status = err?.response?.status;
      let message = 'Failed to load items. Check your connection.';
      if (status === 401) message = 'Session expired. Please log in again.';
      else if (status === 403) message = 'You are not assigned to a household yet.';
      set({ error: message, loading: false });
    }
  },

  async addItem(params) {
    const newItem = await itemService.addItem(params);
    set((state) => {
      // Mirror API ordering: urgent items first, then newest first
      if (newItem.urgent) {
        return { items: [newItem, ...state.items] };
      }
      const lastUrgentIdx = state.items.reduce(
        (acc, item, i) => (item.urgent && item.status !== 'done' ? i : acc),
        -1,
      );
      const updated = [...state.items];
      updated.splice(lastUrgentIdx + 1, 0, newItem);
      return { items: updated };
    });
    return newItem;
  },

  async deleteItem(id) {
    const prev = get().items;
    // Optimistic remove
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    try {
      await itemService.deleteItem(id);
    } catch (err) {
      // Rollback on failure
      set({ items: prev });
      throw err;
    }
  },

  async updateStatus(id, status) {
    const prev = get().items;
    // Optimistic update
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, status } : i)),
    }));
    try {
      const updated = await itemService.updateItemStatus(id, status);
      // Replace with server response to pick up any server-side field changes
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? updated : i)),
      }));
    } catch (err) {
      set({ items: prev });
      throw err;
    }
  },
}));
