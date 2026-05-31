// import { Stack } from 'expo-router';

// export default function RootLayout() {
//   return <Stack />;
// }
import { useEffect, useState } from 'react';
import { View, Image, StyleSheet, Animated } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { COLORS } from '../constants/theme';
import { loadStoredSession } from '../services/auth';
import { useAuthStore } from '../store/authStore';
import '../global.css';

// Keep the native splash visible until we're ready
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);
  const [hasStoredSession, setHasStoredSession] = useState(false);
  const fadeAnim = new Animated.Value(1);
  const scaleAnim = new Animated.Value(1);

  // Load any fonts or assets here
  const [fontsLoaded] = useFonts({
    // 'DMSans-Regular': require('../assets/fonts/DMSans-Regular.ttf'),
    // add custom fonts here when ready
  });

  useEffect(() => {
    async function prepare() {
      try {
        await new Promise((r) => setTimeout(r, 500));
        const { accessToken, role, displayName, userId } = await loadStoredSession();
        if (accessToken) {
          useAuthStore.getState().restore(role, displayName, userId);
          setHasStoredSession(true);
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setAppReady(true);
        await SplashScreen.hideAsync();
      }
    }
    if (fontsLoaded) prepare();
  }, [fontsLoaded]);

  useEffect(() => {
    if (!appReady) return;
    const delay = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.08,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => setShowAnimatedSplash(false));
    }, 1200);

    return () => clearTimeout(delay);
  }, [appReady]);

  useEffect(() => {
    if (!showAnimatedSplash && hasStoredSession) {
      const role = useAuthStore.getState().role;
      router.replace(role === 'family' ? '/(family)/home' : '/(tabs)/home');
    }
  }, [showAnimatedSplash, hasStoredSession]);

  if (!appReady || showAnimatedSplash) {
    return (
      <View style={styles.splash}>
        <Animated.View
          style={[
            styles.logoWrap,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <View style={styles.logoBox}>
            <Image
              source={require('../assets/images/icon.png')}
              style={styles.logoImg}
              resizeMode="contain"
            />
          </View>
        </Animated.View>
      </View>
    );
  }

  // return <Slot />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(family)" />
      <Stack.Screen name="generate-report" />
      <Stack.Screen name="report-results" />
      <Stack.Screen name="weekly-approval" options={{ presentation: 'modal' }} />
      <Stack.Screen name="barcode-confirm" options={{ presentation: 'modal' }} />
      <Stack.Screen name="low-stock" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="add-member" />
      <Stack.Screen name="manage-members" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="health-preferences" />
      <Stack.Screen name="family-members" />
      <Stack.Screen name="preferred-stores" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: COLORS.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBox: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: COLORS.teal[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.teal[600],
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  logoImg: {
    width: 60,
    height: 60,
  },
});