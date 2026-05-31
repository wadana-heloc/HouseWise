import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMemberStore } from '../store/memberStore';
import { useAuthStore } from '../store/authStore';
import { getMe } from '../services/profile';
import { resetMemberPassword } from '../services/members';

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function FamilyMembersScreen() {
  const router = useRouter();
  const { members, loading, error, fetchMembers, deleteMember, updateMember } = useMemberStore();
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState<{ id: string; display_name: string; email: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<{ id: string; display_name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchMembers();
      getMe()
        .then((me) => {
          setHouseholdName(me.household?.name ?? null);
          setAdminId(me.household?.admin_id ?? null);
        })
        .catch(() => {});
    }, []),
  );

  const admin = members.find((m) => m.id === adminId || m.role === 'admin');
  const otherMembers = members.filter((m) => m.id !== admin?.id);

  function openOptions(member: { id: string; display_name: string; email: string }) {
    Alert.alert(member.display_name, undefined, [
      {
        text: 'Edit name & email',
        onPress: () => {
          setEditName(member.display_name);
          setEditEmail(member.email);
          setEditTarget(member);
        },
      },
      {
        text: 'Reset password',
        onPress: () => {
          setNewPassword('');
          setShowNewPassword(false);
          setResetTarget(member);
        },
      },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: () => confirmDelete(member),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(member: { id: string; display_name: string }) {
    Alert.alert(
      'Delete account',
      `Remove ${member.display_name} from the household? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMember(member.id);
            } catch {
              Alert.alert('Error', 'Could not delete the account. Please try again.');
            }
          },
        },
      ],
    );
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter a display name.');
      return;
    }

    const payload: { display_name?: string; email?: string } = {};
    if (editName.trim() !== editTarget.display_name) payload.display_name = editName.trim();
    if (editEmail.trim().toLowerCase() !== editTarget.email.toLowerCase()) payload.email = editEmail.trim();

    if (Object.keys(payload).length === 0) {
      setEditTarget(null);
      return;
    }

    setEditSaving(true);
    try {
      await updateMember(editTarget.id, payload);
      setEditTarget(null);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        Alert.alert('Email taken', 'That email is already registered to another account.');
      } else {
        Alert.alert('Error', 'Could not save changes. Please try again.');
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!resetTarget || !newPassword) {
      Alert.alert('Password required', 'Please enter a new password.');
      return;
    }
    setResetSaving(true);
    try {
      await resetMemberPassword(resetTarget.id, newPassword);
      const name = resetTarget.display_name;
      setResetTarget(null);
      setNewPassword('');
      Alert.alert('Password reset', `New password for ${name} has been set.`);
    } catch {
      Alert.alert('Error', 'Could not reset the password. Please try again.');
    } finally {
      setResetSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Household members</Text>
        {isAdmin && (
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-teal-50 items-center justify-center"
            onPress={() => router.push('/add-member')}
            hitSlop={8}
          >
            <Ionicons name="add" size={22} color="#1D9E75" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16 }}>

        {householdName && (
          <View className="bg-teal-50 border border-teal-600/20 rounded-2xl px-5 py-4 flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-xl bg-teal-600 items-center justify-center">
              <Ionicons name="home-outline" size={19} color="#fff" />
            </View>
            <View>
              <Text className="text-[11px] font-medium text-teal-600 uppercase tracking-wider">Household</Text>
              <Text className="text-[17px] font-semibold text-text-primary mt-0.5">{householdName}</Text>
            </View>
          </View>
        )}

        {loading && (
          <View className="bg-white border border-border rounded-xl py-10 items-center gap-2">
            <ActivityIndicator size="small" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Loading members…</Text>
          </View>
        )}

        {!loading && error && (
          <View className="bg-white border border-border rounded-xl py-10 items-center gap-3">
            <Ionicons name="alert-circle-outline" size={28} color="#D6EDE5" />
            <Text className="text-[13px] text-text-muted">{error}</Text>
            <TouchableOpacity
              className="bg-teal-50 border border-teal-600/20 rounded-full px-4 py-2"
              onPress={fetchMembers}
            >
              <Text className="text-[13px] font-medium text-teal-600">Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && (
          <>
            {/* Head of household */}
            {admin && (
              <View>
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 px-1">
                  Head of household
                </Text>
                <View className="bg-white border border-border rounded-xl overflow-hidden">
                  <View className="flex-row items-center px-4 py-4 gap-3">
                    <View className="w-12 h-12 rounded-full bg-teal-600 items-center justify-center">
                      <Text className="text-[15px] font-semibold text-white">{getInitials(admin.display_name)}</Text>
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <Text className="text-[15px] font-semibold text-text-primary">{admin.display_name}</Text>
                        <View className="flex-row items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <Ionicons name="star" size={10} color="#F59E0B" />
                          <Text className="text-[10px] font-semibold text-amber-600">Head</Text>
                        </View>
                      </View>
                      <Text className="text-[12px] text-text-faint mt-0.5">{admin.email}</Text>
                    </View>
                    {isAdmin && (
                      <TouchableOpacity
                        className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center"
                        onPress={() => router.push('/edit-profile')}
                        hitSlop={6}
                      >
                        <Ionicons name="pencil-outline" size={15} color="#1D9E75" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* Other members */}
            {otherMembers.length > 0 && (
              <View>
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 px-1">
                  Members · {otherMembers.length}
                </Text>
                <View className="bg-white border border-border rounded-xl overflow-hidden">
                  {otherMembers.map((member, i) => (
                    <View
                      key={member.id}
                      className={`flex-row items-center px-4 py-3.5 gap-3 ${i < otherMembers.length - 1 ? 'border-b border-border' : ''}`}
                    >
                      <View className="w-10 h-10 rounded-full bg-teal-50 items-center justify-center">
                        <Text className="text-[13px] font-medium text-teal-600">{getInitials(member.display_name)}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-[14px] font-medium text-text-primary">{member.display_name}</Text>
                        <Text className="text-[12px] text-text-faint mt-0.5">{member.email}</Text>
                      </View>
                      {isAdmin && (
                        <TouchableOpacity
                          className="w-8 h-8 rounded-lg bg-bg-primary items-center justify-center"
                          onPress={() => openOptions(member)}
                          hitSlop={6}
                        >
                          <Ionicons name="ellipsis-horizontal" size={16} color="#6B9E8A" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {members.length === 0 && (
              <View className="bg-white border border-border rounded-xl py-10 items-center gap-3">
                <Ionicons name="people-outline" size={28} color="#D6EDE5" />
                <Text className="text-[13px] text-text-muted">No members yet</Text>
                {isAdmin && (
                  <TouchableOpacity
                    className="bg-teal-50 border border-teal-600/20 rounded-full px-4 py-2"
                    onPress={() => router.push('/add-member')}
                  >
                    <Text className="text-[13px] font-medium text-teal-600">Add first member</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Add member row — admin only */}
            {isAdmin && (
              <TouchableOpacity
                className="bg-white border border-dashed border-teal-600/30 rounded-xl py-3.5 flex-row items-center justify-center gap-2"
                onPress={() => router.push('/add-member')}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add-outline" size={17} color="#1D9E75" />
                <Text className="text-[14px] font-medium text-teal-600">Add member</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Edit member modal ── */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="flex-row items-center mb-5">
                <Text className="flex-1 text-[18px] font-semibold text-text-primary">
                  Edit {editTarget?.display_name}
                </Text>
                <TouchableOpacity onPress={() => setEditTarget(null)} hitSlop={8}>
                  <Ionicons name="close" size={22} color="#6B9E8A" />
                </TouchableOpacity>
              </View>

              <View className="gap-4">
                <View>
                  <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                    Display name
                  </Text>
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    className="bg-bg-primary border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                    placeholder="Full name"
                    placeholderTextColor="#B0C4BC"
                    autoCapitalize="words"
                  />
                </View>
                <View>
                  <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                    Email address
                  </Text>
                  <TextInput
                    value={editEmail}
                    onChangeText={setEditEmail}
                    className="bg-bg-primary border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                    placeholder="email@example.com"
                    placeholderTextColor="#B0C4BC"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <TouchableOpacity
                className={`mt-5 rounded-xl py-4 items-center ${editSaving ? 'bg-teal-300' : 'bg-teal-600'}`}
                onPress={handleSaveEdit}
                disabled={editSaving}
                activeOpacity={0.85}
              >
                {editSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-[15px] font-semibold text-white">Save changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Reset password modal ── */}
      <Modal
        visible={!!resetTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { setResetTarget(null); setNewPassword(''); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
              <View className="flex-row items-center mb-4">
                <Text className="flex-1 text-[18px] font-semibold text-text-primary">Reset password</Text>
                <TouchableOpacity
                  onPress={() => { setResetTarget(null); setNewPassword(''); }}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={22} color="#6B9E8A" />
                </TouchableOpacity>
              </View>

              <View className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex-row gap-2 items-start">
                <Ionicons name="information-circle-outline" size={16} color="#F59E0B" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[12px] text-amber-700 leading-5">
                  No email is sent. Share the new password with {resetTarget?.display_name} directly.
                </Text>
              </View>

              <View>
                <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                  New password
                </Text>
                <View className="flex-row items-center bg-bg-primary border border-border rounded-xl px-4">
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    className="flex-1 py-3.5 text-[14px] text-text-primary"
                    placeholder="Enter new password"
                    placeholderTextColor="#B0C4BC"
                    secureTextEntry={!showNewPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowNewPassword((p) => !p)} hitSlop={8}>
                    <Ionicons
                      name={showNewPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#A8C4B8"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                className={`mt-5 rounded-xl py-4 items-center ${resetSaving ? 'bg-amber-300' : 'bg-amber-500'}`}
                onPress={handleResetPassword}
                disabled={resetSaving}
                activeOpacity={0.85}
              >
                {resetSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-[15px] font-semibold text-white">Set new password</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
