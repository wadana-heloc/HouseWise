import api from './api';

export type ItemStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'done';

export interface Item {
  id: string;
  household_id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  urgent: boolean;
  status: ItemStatus;
  notes: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
}

export interface AddItemParams {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  urgent: boolean;
  notes?: string;
}

export async function getItems(): Promise<Item[]> {
  const { data } = await api.get<{ items: Item[] }>('/items');
  return data.items;
}

export async function addItem(params: AddItemParams): Promise<Item> {
  const { data } = await api.post<Item>('/items', params);
  return data;
}

export async function deleteItem(itemId: string): Promise<void> {
  await api.delete(`/items/${itemId}`);
}

export async function updateItemStatus(itemId: string, status: ItemStatus): Promise<Item> {
  const { data } = await api.post<Item>(`/items/${itemId}/status`, { status });
  return data;
}
