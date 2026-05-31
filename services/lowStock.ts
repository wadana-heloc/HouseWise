import api from './api';

export interface LowStockFlag {
  id: string;
  household_id: string;
  name: string;
  added_by: string;
  added_by_display_name: string;
  created_at: string;
  updated_at: string;
}

export async function getFlags(): Promise<LowStockFlag[]> {
  const { data } = await api.get<{ flags: LowStockFlag[] }>('/low-stock');
  return data.flags;
}

export async function addFlag(name: string): Promise<LowStockFlag> {
  const { data } = await api.post<LowStockFlag>('/low-stock', { name });
  return data;
}

export async function deleteFlag(flagId: string): Promise<void> {
  await api.delete(`/low-stock/${flagId}`);
}
