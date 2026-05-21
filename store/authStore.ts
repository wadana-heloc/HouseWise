import { create } from 'zustand';
import * as authService from '../services/auth';
import type { SignupParams } from '../services/auth';

interface AuthState {
  isAuthenticated: boolean;
  role: string | null;
  displayName: string | null;
  userId: string | null;
  restore: (role: string | null, displayName: string | null, userId: string | null) => void;
  login: (email: string, password: string) => Promise<string>;
  signup: (params: SignupParams) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  role: null,
  displayName: null,
  userId: null,

  restore(role, displayName, userId) {
    set({ isAuthenticated: true, role, displayName, userId });
  },

  async login(email, password) {
    const session = await authService.login(email, password);
    const role = authService.getRole(session);
    const displayName = authService.getDisplayName(session);
    const userId = session.user.id;
    set({ isAuthenticated: true, role, displayName, userId });
    return role;
  },

  async signup(params) {
    await authService.signup(params);
    // Don't auto-login after registration — user must sign in explicitly
    await authService.clearSession();
  },

  async logout() {
    await authService.logout();
    set({ isAuthenticated: false, role: null, displayName: null });
  },
}));
