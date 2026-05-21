import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { COLORS, FONTS, RADIUS, SPACING } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

export default function RegisterScreen() {
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);
  const [householdName, setHouseholdName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!householdName || !displayName || !email || !password || !confirmPassword) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await signup({
        household_name: householdName,
        display_name: displayName,
        email,
        password,
      });
      router.replace('/(auth)/login');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 409) {
          Alert.alert('Email taken', 'An account with this email already exists.');
        } else if (!err.response) {
          Alert.alert('Connection error', 'Could not reach the server. Check your network.');
        } else {
          const detail = err.response.data?.detail;
          Alert.alert('Registration failed', typeof detail === 'string' ? detail : 'Something went wrong.');
        }
      } else {
        Alert.alert('Registration failed', 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg.primary} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back button */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={COLORS.text.secondary} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoMini}>
              <Ionicons name="home" size={24} color={COLORS.white} />
            </View>
            <Text style={styles.title}>Create your household</Text>
            <Text style={styles.subtitle}>Set up HouseWise for your family</Text>
          </View>

          {/* Section label */}
          <Text style={styles.sectionLabel}>Household details</Text>

          <View style={styles.form}>
            {/* Household name */}
            <View style={styles.fieldWrap}>
              <Ionicons name="home-outline" size={18} color={COLORS.text.faint} style={styles.fieldIcon} />
              <TextInput
                style={styles.input}
                placeholder="Household name (e.g. The Khalil Family)"
                placeholderTextColor={COLORS.text.faint}
                value={householdName}
                onChangeText={setHouseholdName}
                autoCapitalize="words"
              />
            </View>

            {/* Display name */}
            <View style={styles.fieldWrap}>
              <Ionicons name="person-outline" size={18} color={COLORS.text.faint} style={styles.fieldIcon} />
              <TextInput
                style={styles.input}
                placeholder="Your display name"
                placeholderTextColor={COLORS.text.faint}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            </View>
          </View>

          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>Account credentials</Text>

          <View style={styles.form}>
            {/* Email */}
            <View style={styles.fieldWrap}>
              <Ionicons name="mail-outline" size={18} color={COLORS.text.faint} style={styles.fieldIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={COLORS.text.faint}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.text.faint} style={styles.fieldIcon} />
              <TextInput
                style={[styles.input, styles.inputPaddingRight]}
                placeholder="Password (min. 8 characters)"
                placeholderTextColor={COLORS.text.faint}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={COLORS.text.muted}
                />
              </TouchableOpacity>
            </View>

            {/* Confirm password */}
            <View style={styles.fieldWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.text.faint} style={styles.fieldIcon} />
              <TextInput
                style={[styles.input, styles.inputPaddingRight]}
                placeholder="Confirm password"
                placeholderTextColor={COLORS.text.faint}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm}
                autoComplete="new-password"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm((v) => !v)}>
                <Ionicons
                  name={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={COLORS.text.muted}
                />
              </TouchableOpacity>
            </View>

            {/* Hint */}
            <View style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={15} color={COLORS.teal[600]} />
              <Text style={styles.hintText}>
                The weekly shopping report will be sent to this email address.
              </Text>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleRegister}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Create household</Text>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg.primary,
  },
  inner: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  backBtn: {
    marginBottom: SPACING.lg,
    padding: SPACING.xs,
    alignSelf: 'flex-start',
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoMini: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.teal[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    shadowColor: COLORS.teal[600],
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 26,
    color: COLORS.text.primary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.text.muted,
    marginTop: 6,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  form: {
    gap: SPACING.sm,
  },
  fieldWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  fieldIcon: {
    position: 'absolute',
    left: 14,
    zIndex: 1,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    paddingLeft: 44,
    paddingRight: 16,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: COLORS.text.primary,
  },
  inputPaddingRight: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    padding: 4,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: COLORS.teal[50],
    borderRadius: RADIUS.md,
    padding: SPACING.sm + 4,
  },
  hintText: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.teal[600],
    lineHeight: 18,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.teal[600],
    marginTop: SPACING.xs,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.xl,
  },
  footerText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.text.muted,
  },
  footerLink: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.teal[600],
    fontWeight: '500',
  },
  white: {
    color: COLORS.white,
  },
});