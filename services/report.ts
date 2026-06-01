import api from './api';

export type SelectedItemPayload = {
  itemName: string;
  qty: number;
  unit: string;
  requestedBy: string;
  selectedOption: {
    store: string;
    productName: string;
    price: number;
    size: string;
    pricePerUnit: string;
    healthBadge?: 'healthy' | 'standard';
  };
};

export type SendReportEmailPayload = {
  items: SelectedItemPayload[];
  grandTotal: number;
};

export async function sendReportEmail(payload: SendReportEmailPayload): Promise<void> {
  await api.post('/reports/send-email', payload);
}
