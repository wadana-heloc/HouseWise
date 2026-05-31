import api from './api';

export interface Store {
  id: string;
  household_id: string;
  name: string;
  url: string;
  added_by: string;
  created_at: string;
  updated_at: string;
}

export async function listStores(): Promise<Store[]> {
  const { data } = await api.get<{ stores: Store[] }>('/stores');
  return data.stores;
}

export async function addStore(name: string, url: string): Promise<Store> {
  const { data } = await api.post<Store>('/stores', { name, url });
  return data;
}

export async function updateStore(
  storeId: string,
  params: { name?: string; url?: string },
): Promise<Store> {
  const { data } = await api.patch<Store>(`/stores/${storeId}`, params);
  return data;
}

export async function deleteStore(storeId: string): Promise<void> {
  await api.delete(`/stores/${storeId}`);
}
