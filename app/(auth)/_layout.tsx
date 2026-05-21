import { Stack } from 'expo-router';

// this layout wraps all auth-related screens (login, register, forgot-password)
// it can be used to provide a common background, header, or other shared UI
// for simplicity, we're just hiding the header here, but you could easily add a logo or other elements that should be consistent across auth screens
// note: we have a separate animated splash screen in the root layout, so we don't need to do anything special here for loading states
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}