import { create } from 'zustand';
import type { PriceSearchItemResult } from '../services/toBuy';

export interface ReportStoreItem {
  id: string;          // items row UUID (for ToBuyEntryIn.item_id)
  name: string;
  quantity: number;
  unit: string;
  priceResult: PriceSearchItemResult;
}

interface ReportState {
  items: ReportStoreItem[];
  existingToBuyCount: number; // how many un-bought entries are on the current list
  setResults: (items: ReportStoreItem[], existingCount: number) => void;
  clear: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  items: [],
  existingToBuyCount: 0,

  setResults(items, existingCount) {
    set({ items, existingToBuyCount: existingCount });
  },

  clear() {
    set({ items: [], existingToBuyCount: 0 });
  },
}));
