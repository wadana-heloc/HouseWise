import { create } from 'zustand';
import * as memberService from '../services/members';
import type { Member } from '../services/members';

interface MemberState {
  members: Member[];
  loading: boolean;
  error: string | null;
  fetchMembers: () => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: [],
  loading: false,
  error: null,

  async fetchMembers() {
    set({ loading: true, error: null });
    try {
      const members = await memberService.listMembers();
      set({ members, loading: false });
    } catch (err: any) {
      const status = err?.response?.status;
      let message = 'Failed to load members. Check your connection.';
      if (status === 401) message = 'Session expired. Please log in again.';
      else if (status === 403) message = 'You are not assigned to a household yet.';
      set({ error: message, loading: false });
    }
  },

  async deleteMember(id) {
    const prev = get().members;
    set((state) => ({ members: state.members.filter((m) => m.id !== id) }));
    try {
      await memberService.deleteMember(id);
    } catch (err) {
      set({ members: prev });
      throw err;
    }
  },
}));
