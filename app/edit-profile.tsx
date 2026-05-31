import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getMe, updateProfile } from '../services/profile';

export default function EditProfileScreen() {
  const router = useRouter();
  const storedName = useAuthStore((s) => s.displayName) ?? '';
  const storedEmail = useAuthStore((s) => s.email) ?? '';
  const setProfile = useAuthStore((s) => s.setProfile);

  const [originalName, setOriginalName] = useState(storedName);
  const [originalEmail, setOriginalEmail] = useState(storedEmail);
  const [name, setName] = useState(storedName);
  const [email, setEmail] = useState(storedEmail);
  const [loadingEmail, setLoadingEmail] = useState(!storedEmail);
  const [saving, setSaving] = useState(false);

  const initials = name.trim()
    ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const hasChanges =
    name.trim() !== originalName.trim() ||
    email.trim().toLowerCase() !== originalEmail.trim().toLowerCase();

  useEffect(() => {
    if (storedEmail) return;
    async function fetchEmail() {
      try {
        const me = await getMe();
        const fetchedEmail = me.user.email;
        setOriginalEmail(fetchedEmail);
        setEmail(fetchedEmail);
      } catch {
        // keep empty if fetch fails
      } finally {
        setLoadingEmail(false);
      }
    }
    fetchEmail();
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }

    const payload: { display_name?: string; email?: string } = {};
    if (name.trim() !== originalName.trim()) payload.display_name = name.trim();
    if (email.trim().toLowerCase() !== originalEmail.trim().toLowerCase()) payload.email = email.trim();

    setSaving(true);
    try {
      await updateProfile(payload);
      setProfile(name.trim(), email.trim());
      setOriginalName(name.trim());
      setOriginalEmail(email.trim());
      Alert.alert('Profile updated', 'Your changes have been saved.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        Alert.alert('Email taken', 'That email address is already registered to another account.');
      } else {
        Alert.alert('Error', 'Could not save your changes. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Edit profile</Text>
        {hasChanges && !saving && (
          <TouchableOpacity onPress={handleSave}>
            <Text className="text-[14px] font-semibold text-teal-600">Save</Text>
          </TouchableOpacity>
        )}
        {saving && <ActivityIndicator size="small" color="#1D9E75" />}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 24 }}
        >
          <View className="items-center pt-2 pb-2">
            <View className="w-24 h-24 rounded-full bg-teal-600 items-center justify-center mb-3">
              <Text className="text-[32px] font-medium text-white">{initials}</Text>
            </View>
            <TouchableOpacity
              className="flex-row items-center gap-1.5"
              onPress={() => Alert.alert('Coming soon', 'Photo upload will be available soon.')}
            >
              <Ionicons name="camera-outline" size={15} color="#1D9E75" />
              <Text className="text-[13px] font-medium text-teal-600">Change photo</Text>
            </TouchableOpacity>
          </View>

          <View className="gap-3">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider px-1">
              Personal info
            </Text>

            <View className="bg-white border border-border rounded-xl overflow-hidden">
              <View className="flex-row items-center px-4 py-3.5 gap-3 border-b border-border">
                <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                  <Ionicons name="person-outline" size={17} color="#1D9E75" />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] text-text-faint mb-0.5">Display name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Your name"
                    placeholderTextColor="#B0C4BC"
                    className="text-[14px] text-text-primary p-0"
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View className="flex-row items-center px-4 py-3.5 gap-3">
                <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                  <Ionicons name="mail-outline" size={17} color="#1D9E75" />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] text-text-faint mb-0.5">Email address</Text>
                  {loadingEmail ? (
                    <ActivityIndicator size="small" color="#1D9E75" style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      placeholder="your@email.com"
                      placeholderTextColor="#B0C4BC"
                      className="text-[14px] text-text-primary p-0"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      returnKeyType="done"
                    />
                  )}
                </View>
              </View>
            </View>
          </View>

          <TouchableOpacity
            className={`rounded-xl py-4 items-center ${hasChanges && !saving ? 'bg-teal-600' : 'bg-teal-100'}`}
            onPress={handleSave}
            activeOpacity={0.85}
            disabled={!hasChanges || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#1D9E75" />
            ) : (
              <Text className={`text-[16px] font-semibold ${hasChanges ? 'text-white' : 'text-teal-300'}`}>
                Save changes
              </Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
