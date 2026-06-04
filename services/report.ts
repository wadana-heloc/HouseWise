import api from './api';

// ─── Report settings ─────────────────────────────────────────────────────────

export interface ReportSettings {
  report_day: number;       // ISO weekday: 1=Mon … 7=Sun
  report_time: string;      // "HH:MM" 24h, leading zero required
  report_timezone: string;  // IANA name, validated server-side
}

export async function getReportSettings(): Promise<ReportSettings> {
  const { data } = await api.get<ReportSettings>('/household/report-settings');
  return data;
}

export async function patchReportSettings(
  fields: Partial<Pick<ReportSettings, 'report_day' | 'report_time' | 'report_timezone'>>,
): Promise<ReportSettings> {
  const { data } = await api.patch<ReportSettings>('/household/report-settings', fields);
  return data;
}

// ─── Send report email ────────────────────────────────────────────────────────

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
