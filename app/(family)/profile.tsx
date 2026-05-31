import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';


const MENU_SECTIONS = [
  {
    title: 'Household',
    items: [
      { icon: 'people-outline',     label: 'Members',            route: '/family-members' },
      { icon: 'storefront-outline', label: 'Preferred stores',   route: '/preferred-stores' },
      { icon: 'heart-outline',      label: 'Health preferences', route: '/health-preferences' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'lock-closed-outline', label: 'Change password', route: '/settings' },
    ],
  },
];

export default function ProfileScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const displayName = useAuthStore((s) => s.displayName) ?? 'User';
  const role = useAuthStore((s) => s.role) ?? 'family';
  const initials = displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const roleLabel = role === 'family' ? 'Family Member' : 'Admin · Head of Household';
  const [signingOut, setSigningOut] = useState(false);

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await logout();
            router.replace('/(auth)/login');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border">
        <Text className="text-[22px] font-medium text-text-primary">Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 20 }}>

        {/* Profile card */}
        <View className="bg-white border border-border rounded-2xl p-5 items-center">
          <View className="w-20 h-20 rounded-full bg-teal-600 items-center justify-center mb-3">
            <Text className="text-[28px] font-medium text-white">{initials}</Text>
          </View>
          <Text className="text-[20px] font-medium text-text-primary">{displayName}</Text>
          <Text className="text-[13px] text-text-muted mt-1">{roleLabel}</Text>
        </View>

        {/* Menu sections */}
        {MENU_SECTIONS.map((section) => (
          <View key={section.title}>
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 px-1">{section.title}</Text>
            <View className="bg-white border border-border rounded-xl overflow-hidden">
              {section.items.map((item, i) => (
                <TouchableOpacity
                  key={item.label}
                  className={`flex-row items-center px-4 py-3.5 gap-3 ${i < section.items.length - 1 ? 'border-b border-border' : ''}`}
                  onPress={() => router.push(item.route as any)}
                  activeOpacity={0.7}
                >
                  <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                    <Ionicons name={item.icon as any} size={17} color="#1D9E75" />
                  </View>
                  <Text className="flex-1 text-[14px] text-text-primary">{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#D6EDE5" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Sign out */}
        <TouchableOpacity
          className="bg-white border border-border rounded-xl py-4 flex-row items-center justify-center gap-2"
          onPress={handleSignOut}
          activeOpacity={0.8}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator size="small" color="#E24B4A" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color="#E24B4A" />
              <Text className="text-[15px] font-medium" style={{ color: '#E24B4A' }}>Sign out</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}