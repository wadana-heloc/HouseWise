import { useEffect, useState } from 'react';
import { View, Text, StatusBar, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getMe } from '../services/profile';

export default function ReportEmailScreen() {
  const router = useRouter();
  const storedEmail = useAuthStore((s) => s.email);
  const [email, setEmail] = useState(storedEmail ?? '');
  const [loading, setLoading] = useState(!storedEmail);

  useEffect(() => {
    if (storedEmail) return;
    getMe()
      .then((me) => setEmail(me.user.email))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Report email</Text>
      </View>

      <View className="px-5 pt-6 gap-4">

        {/* Email display card */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden">
          <View className="px-5 pt-5 pb-4">
            <View className="flex-row items-center gap-3 mb-4">
              <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="mail-outline" size={20} color="#1D9E75" />
              </View>
              <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                Weekly report destination
              </Text>
            </View>

            {loading ? (
              <ActivityIndicator size="small" color="#1D9E75" style={{ alignSelf: 'flex-start' }} />
            ) : (
              <Text className="text-[17px] font-semibold text-text-primary">{email || '—'}</Text>
            )}
          </View>

          <View className="h-px bg-border" />

          <View className="px-5 py-4 flex-row gap-2.5 items-start">
            <Ionicons name="information-circle-outline" size={16} color="#6B9E8A" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-text-muted leading-5">
              Your household's weekly shopping report is automatically sent to this address every week.
              This is your account's login email.
            </Text>
          </View>
        </View>

        {/* How to change */}
        <View className="bg-teal-50 border border-teal-600/15 rounded-2xl px-5 py-4 gap-2">
          <View className="flex-row items-center gap-2">
            <Ionicons name="pencil-outline" size={16} color="#1D9E75" />
            <Text className="text-[13px] font-semibold text-teal-800">Want to change it?</Text>
          </View>
          <Text className="text-[12px] text-teal-700 leading-5">
            Update your email in Edit profile. The weekly report will automatically be sent to the new address.
          </Text>
          <TouchableOpacity
            className="mt-1 self-start bg-teal-600 rounded-xl px-4 py-2.5"
            onPress={() => router.push('/edit-profile')}
            activeOpacity={0.85}
          >
            <Text className="text-[13px] font-semibold text-white">Edit profile</Text>
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
}
