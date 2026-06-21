import api from './api';

// ─── Price search ─────────────────────────────────────────────────────────────

export interface PriceOption {
  store_url: string;
  store_name: string;
  price: number | null;
  currency: string;
  product_url: string | null;
  product_name_as_found: string | null;
  unit_price: number | null;
  unit: string | null;
}

export interface PriceSearchItemResult {
  item: string;
  prices: PriceOption[];
  cheapest_store_url: string | null;
  cheapest_price: number | null;
  best_value_store_url: string | null;
  best_value_unit_price: number | null;
  best_value_unit: string | null;
}

export interface PriceSearchResponse {
  results: PriceSearchItemResult[];
}

export async function searchPrices(
  items: string[],
  use_low_stock = false,
): Promise<PriceSearchResponse> {
  const { data } = await api.post<PriceSearchResponse>(
    '/prices/search',
    { items, use_low_stock },
    { timeout: 90_000 }, // agent can take up to 30s; give plenty of headroom
  );
  return data;
}

// ─── To-buy list ──────────────────────────────────────────────────────────────

export interface ToBuyEntryIn {
  item_id: string;
  chosen_store_url: string;
  chosen_store_name: string;
  chosen_price: string; // decimal-as-string e.g. "8.50"
  currency: string;
}

export interface ToBuyEntry {
  id: string;
  household_id: string;
  item_id: string;
  item_name: string;
  quantity: string;
  unit: string;
  chosen_store_url: string;
  chosen_store_name: string;
  chosen_price: string;
  currency: string;
  snapshot_at: string;
  added_by: string;
  created_at: string;
  updated_at: string;
}

export interface ToBuyListOut {
  entries: ToBuyEntry[];
  item_count: number;
  estimated_total: string;
  currency: string;
}

export async function getToBuyList(): Promise<ToBuyListOut> {
  const { data } = await api.get<ToBuyListOut>('/to-buy');
  return data;
}

export async function saveToBuyList(entries: ToBuyEntryIn[]): Promise<ToBuyListOut> {
  const { data } = await api.post<ToBuyListOut>('/to-buy', { entries });
  return data;
}

export async function markEntryDone(entryId: string): Promise<void> {
  await api.post(`/to-buy/${entryId}/done`);
}

export async function deleteEntry(entryId: string): Promise<void> {
  await api.delete(`/to-buy/${entryId}`);
}
