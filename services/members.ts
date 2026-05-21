import api from './api';

export interface Member {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'family';
}

export async function listMembers(): Promise<Member[]> {
  const res = await api.get<{ members: Member[] }>('/household/members');
  return res.data.members;
}

export async function deleteMember(memberId: string): Promise<void> {
  await api.delete(`/household/members/${memberId}`);
}
