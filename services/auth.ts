import * as SecureStore from 'expo-secure-store';
import api, { TOKEN_KEYS } from './api';

export interface SupabaseUser {
  id: string;
  email: string;
  app_metadata: { role?: string };
  user_metadata?: { display_name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: SupabaseUser;
}

export interface SignupParams {
  household_name: string;
  display_name: string;
  email: string;
  password: string;
}

export interface SignupResponse {
  user_id: string;
  household_id: string;
  session: Session;
}

export function getRole(session: Session): string {
  return session.user?.app_metadata?.role ?? 'family';
}

export function getDisplayName(session: Session): string {
  return (
    session.user?.user_metadata?.display_name ??
    session.user?.email?.split('@')[0] ??
    'User'
  );
}

export async function login(email: string, password: string): Promise<Session> {
  const { data } = await api.post<Session>('/auth/login', { email, password });
  await _saveSession(data);
  return data;
}

export async function signup(params: SignupParams): Promise<SignupResponse> {
  const { data } = await api.post<SignupResponse>('/auth/signup', params);
  await _saveSession(data.session);
  return data;
}

export async function loadStoredSession(): Promise<{
  accessToken: string | null;
  role: string | null;
  displayName: string | null;
  userId: string | null;
}> {
  const [accessToken, role, displayName, userId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEYS.access),
    SecureStore.getItemAsync(TOKEN_KEYS.role),
    SecureStore.getItemAsync(TOKEN_KEYS.displayName),
    SecureStore.getItemAsync(TOKEN_KEYS.userId),
  ]);
  return { accessToken, role, displayName, userId };
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    // Always clear local tokens even if the API call fails (e.g. token already expired)
    await clearSession();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/password-update', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEYS.access),
    SecureStore.deleteItemAsync(TOKEN_KEYS.refresh),
    SecureStore.deleteItemAsync(TOKEN_KEYS.role),
    SecureStore.deleteItemAsync(TOKEN_KEYS.displayName),
  ]);
}

async function _saveSession(session: Session): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEYS.access, session.access_token),
    SecureStore.setItemAsync(TOKEN_KEYS.refresh, session.refresh_token),
    SecureStore.setItemAsync(TOKEN_KEYS.role, getRole(session)),
    SecureStore.setItemAsync(TOKEN_KEYS.displayName, getDisplayName(session)),
    SecureStore.setItemAsync(TOKEN_KEYS.userId, session.user.id),
  ]);
}
