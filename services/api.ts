import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { API_BASE_URL } from '../constants/config';

export const TOKEN_KEYS = {
  access: 'hw_access_token',
  refresh: 'hw_refresh_token',
  role: 'hw_role',
  displayName: 'hw_display_name',
  userId: 'hw_user_id',
} as const;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEYS.access);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, attempt one silent token refresh then retry.
// Only wipe the session when we know the refresh endpoint is reachable but
// the refresh token itself is rejected — not when the config is missing.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    // No Supabase config loaded yet (e.g. env var missing) — don't log out.
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return Promise.reject(error);
    }

    const newToken = await _tryRefresh();
    if (newToken) {
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    }

    // Refresh token is also rejected — session is truly dead.
    await _clearTokens();
    router.replace('/(auth)/login');
    return Promise.reject(error);
  },
);

async function _tryRefresh(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(TOKEN_KEYS.refresh);
  if (!refreshToken || !SUPABASE_URL) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEYS.access, data.access_token),
      SecureStore.setItemAsync(TOKEN_KEYS.refresh, data.refresh_token),
    ]);
    return data.access_token as string;
  } catch {
    return null;
  }
}

async function _clearTokens() {
  await Promise.all(Object.values(TOKEN_KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}

export default api;
