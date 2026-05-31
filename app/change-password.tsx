import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { changePassword } from '../services/auth';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordsMatch = newPassword === confirmPassword;
  const newIsValid = newPassword.length >= 8;
  const canSubmit = !!currentPassword && newIsValid && !!confirmPassword && passwordsMatch;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert('Password updated', 'Your password has been changed successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 400) {
        Alert.alert('Incorrect password', 'Your current password is wrong. Please try again.');
      } else {
        Alert.alert('Error', 'Could not update your password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Change password</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 20 }}
        >
          <View className="bg-white border border-border rounded-2xl overflow-hidden">

            {/* Current password */}
            <View className="flex-row items-center px-4 py-3.5 gap-3 border-b border-border">
              <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                <Ionicons name="lock-closed-outline" size={17} color="#1D9E75" />
              </View>
              <View className="flex-1">
                <Text className="text-[11px] text-text-faint mb-0.5">Current password</Text>
                <TextInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter current password"
                  placeholderTextColor="#B0C4BC"
                  className="text-[14px] text-text-primary p-0"
                  secureTextEntry={!showCurrent}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <TouchableOpacity onPress={() => setShowCurrent((p) => !p)} hitSlop={8}>
                <Ionicons name={showCurrent ? 'eye-off-outline' : 'eye-outline'} size={18} color="#A8C4B8" />
              </TouchableOpacity>
            </View>

            {/* New password */}
            <View className="flex-row items-center px-4 py-3.5 gap-3 border-b border-border">
              <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                <Ionicons name="key-outline" size={17} color="#1D9E75" />
              </View>
              <View className="flex-1">
                <Text className="text-[11px] text-text-faint mb-0.5">New password</Text>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Min. 8 characters"
                  placeholderTextColor="#B0C4BC"
                  className="text-[14px] text-text-primary p-0"
                  secureTextEntry={!showNew}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <TouchableOpacity onPress={() => setShowNew((p) => !p)} hitSlop={8}>
                <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={18} color="#A8C4B8" />
              </TouchableOpacity>
            </View>

            {/* Confirm password */}
            <View className="flex-row items-center px-4 py-3.5 gap-3">
              <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                <Ionicons name="checkmark-circle-outline" size={17} color="#1D9E75" />
              </View>
              <View className="flex-1">
                <Text className="text-[11px] text-text-faint mb-0.5">Confirm new password</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter new password"
                  placeholderTextColor="#B0C4BC"
                  className={`text-[14px] p-0 ${confirmPassword && !passwordsMatch ? 'text-red-500' : 'text-text-primary'}`}
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <TouchableOpacity onPress={() => setShowConfirm((p) => !p)} hitSlop={8}>
                <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#A8C4B8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Validation hints */}
          {confirmPassword.length > 0 && !passwordsMatch && (
            <View className="flex-row items-center gap-2 px-1">
              <Ionicons name="close-circle-outline" size={14} color="#EF4444" />
              <Text className="text-[12px] text-red-400">Passwords don't match</Text>
            </View>
          )}
          {newPassword.length > 0 && !newIsValid && (
            <View className="flex-row items-center gap-2 px-1">
              <Ionicons name="close-circle-outline" size={14} color="#EF4444" />
              <Text className="text-[12px] text-red-400">Password must be at least 8 characters</Text>
            </View>
          )}

          <TouchableOpacity
            className={`rounded-xl py-4 items-center ${canSubmit && !loading ? 'bg-teal-600' : 'bg-teal-100'}`}
            onPress={handleSubmit}
            disabled={!canSubmit || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#1D9E75" />
            ) : (
              <Text className={`text-[16px] font-semibold ${canSubmit ? 'text-white' : 'text-teal-300'}`}>
                Update password
              </Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
