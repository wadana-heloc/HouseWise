import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '../constants/theme';
import { useAuthStore } from '../store/authStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(role === 'family' ? '/(family)/home' : '/(tabs)/home');
    }
  }, [isAuthenticated, role]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg.primary} />

      {/* Logo */}
      <View style={styles.logoSection}>
        <View style={styles.logoBox}>
          <Ionicons name="home" size={40} color={COLORS.white} />
        </View>
        <Text style={styles.appName}>HouseWise</Text>
        <Text style={styles.tagline}>SMART HOME SHOPPING</Text>
      </View>

      {/* Feature cards */}
      <View style={styles.features}>
        <FeatureCard
          icon="cart-outline"
          title="Smart shopping lists"
          subtitle="Shared across your whole family"
        />
        <FeatureCard
          icon="cash-outline"
          title="AI price comparison"
          subtitle="Best price/unit across UAE stores"
        />
        <FeatureCard
          icon="heart-outline"
          title="Health-first recommendations"
          subtitle="Tailored to your family's goals"
        />
      </View>

      {/* CTA Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push('/(auth)/register')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.push('/(auth)/login')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </TouchableOpacity>

        <Text style={styles.note}>Invitation-only · Private family account</Text>
      </View>
    </SafeAreaView>
  );
}

function FeatureCard({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>
        <Ionicons name={icon} size={20} color={COLORS.teal[600]} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg.primary,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 48,
  },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.teal[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: COLORS.teal[600],
    shadowOpacity: 0.30,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  appName: {
    fontFamily: FONTS.display,
    fontSize: 36,
    color: COLORS.text.primary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.teal[600],
    letterSpacing: 3,
    marginTop: 8,
    fontWeight: '600',
  },
  features: {
    gap: 12,
    marginVertical: 36,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.teal[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text.primary,
  },
  cardSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.text.muted,
    marginTop: 3,
  },
  actions: {
    gap: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.teal[600],
  },
  primaryBtnText: {
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text.primary,
  },
  note: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.text.faint,
    marginTop: 4,
  },
  white: {
    color: COLORS.white,
  },
});