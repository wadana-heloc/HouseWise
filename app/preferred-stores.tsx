import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useStoresStore } from '../store/storesStore';

export default function PreferredStoresScreen() {
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
  const { stores, loading, error, fetchStores, addStore, deleteStore } = useStoresStore();

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const urlInputRef = useRef<TextInput>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    if (!loading) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchStores();
    setRefreshing(false);
  }

  async function handleAdd() {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;

    setAdding(true);
    try {
      await addStore(name, url);
      setNewName('');
      setNewUrl('');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        Alert.alert('Already exists', `"${name}" is already in your household's store list.`);
      } else if (status === 422) {
        Alert.alert('Invalid input', 'Please enter a valid store name and URL (e.g. carrefour.ae).');
      } else {
        Alert.alert('Error', 'Could not add store. Please try again.');
      }
    } finally {
      setAdding(false);
    }
  }

  function confirmDelete(id: string, name: string) {
    Alert.alert(
      'Remove store',
      `Remove "${name}" from your household's stores?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStore(id);
            } catch {
              Alert.alert('Error', 'Could not remove store. Please try again.');
            }
          },
        },
      ],
    );
  }

  const canAdd = newName.trim().length > 0 && newUrl.trim().length > 0;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          className="w-9 h-9 rounded-full bg-bg-primary items-center justify-center"
        >
          <Ionicons name="arrow-back" size={20} color="#3D6B55" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-[20px] font-semibold text-text-primary">Preferred stores</Text>
          <Text className="text-[12px] text-text-muted mt-0.5">
            {isAdmin ? 'Manage your household stores' : "Your household's shopping destinations"}
          </Text>
        </View>
        <View className="w-10 h-10 rounded-2xl bg-teal-50 items-center justify-center">
          <Ionicons name="storefront" size={20} color="#1D9E75" />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#1D9E75"
            colors={['#1D9E75']}
          />
        }
      >
        {/* Info banner */}
        <View className="bg-teal-50 border border-teal-100 rounded-2xl px-4 py-3.5 flex-row items-start gap-3">
          <View className="w-7 h-7 rounded-lg bg-teal-100 items-center justify-center mt-0.5">
            <Ionicons name="sparkles" size={14} color="#1D9E75" />
          </View>
          <Text className="flex-1 text-[13px] text-teal-800 leading-[19px]">
            The AI compares prices <Text className="font-semibold">only at these stores</Text> when
            generating your household's shopping reports.
          </Text>
        </View>

        {/* Loading skeleton */}
        {loading && stores.length === 0 && (
          <View className="py-14 items-center gap-3">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Loading stores…</Text>
          </View>
        )}

        {/* Error banner */}
        {!!error && !loading && (
          <View className="bg-red-50 border border-red-100 rounded-2xl px-4 py-4 flex-row items-center gap-3">
            <View className="w-8 h-8 rounded-xl bg-red-100 items-center justify-center">
              <Ionicons name="alert-circle" size={17} color="#E24B4A" />
            </View>
            <Text className="flex-1 text-[13px] text-red-600 leading-5">{error}</Text>
            <TouchableOpacity
              onPress={fetchStores}
              hitSlop={8}
              className="px-3 py-1.5 rounded-lg bg-red-100"
            >
              <Text className="text-[12px] font-semibold text-red-600">Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Store list */}
        {stores.length > 0 && (
          <Animated.View style={{ opacity: fadeAnim }} className="gap-2">
            <Text className="text-[12px] font-semibold text-text-muted uppercase tracking-widest px-1">
              {stores.length} {stores.length === 1 ? 'store' : 'stores'}
            </Text>
            <View className="bg-white border border-border rounded-2xl overflow-hidden">
              {stores.map((store, i) => (
                <View
                  key={store.id}
                  className={`flex-row items-center px-4 py-3.5 gap-3 ${
                    i < stores.length - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                    <Ionicons name="storefront" size={19} color="#1D9E75" />
                  </View>
                  <View className="flex-1 min-w-0 gap-0.5">
                    <Text
                      className="text-[14px] font-semibold text-text-primary"
                      numberOfLines={1}
                    >
                      {store.name}
                    </Text>
                    {!!store.url && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(store.url)}
                        activeOpacity={0.6}
                      >
                        <Text
                          className="text-[12px] text-teal-600"
                          numberOfLines={1}
                        >
                          {store.url}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {isAdmin && (
                    <TouchableOpacity
                      onPress={() => confirmDelete(store.id, store.name)}
                      hitSlop={8}
                      className="w-8 h-8 items-center justify-center rounded-xl bg-red-50"
                    >
                      <Ionicons name="trash-outline" size={16} color="#E24B4A" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Empty state */}
        {!loading && !error && stores.length === 0 && (
          <View className="bg-white border border-border rounded-2xl py-14 items-center gap-3 px-8">
            <View className="w-16 h-16 rounded-2xl bg-teal-50 items-center justify-center mb-1">
              <Ionicons name="storefront-outline" size={30} color="#1D9E75" />
            </View>
            <Text className="text-[16px] font-semibold text-text-primary text-center">
              No stores yet
            </Text>
            <Text className="text-[13px] text-text-muted text-center leading-5">
              {isAdmin
                ? 'Add your first store below so the AI knows where to compare prices.'
                : 'Ask your household admin to add stores for price comparisons.'}
            </Text>
          </View>
        )}

        {/* Add store — admin only */}
        {isAdmin && (
          <View className="gap-3">
            <Text className="text-[12px] font-semibold text-text-muted uppercase tracking-widest px-1">
              Add a store
            </Text>

            {/* Inputs card */}
            <View className="bg-white border border-border rounded-2xl overflow-hidden">
              <View className="px-4 py-3.5 border-b border-border flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-teal-50 items-center justify-center">
                  <Ionicons name="pricetag-outline" size={15} color="#1D9E75" />
                </View>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  className="flex-1 text-[14px] text-text-primary"
                  placeholder="Store name  (e.g. Carrefour UAE)"
                  placeholderTextColor="#B0C4BC"
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => urlInputRef.current?.focus()}
                />
              </View>
              <View className="px-4 py-3.5 flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-teal-50 items-center justify-center">
                  <Ionicons name="link-outline" size={15} color="#1D9E75" />
                </View>
                <TextInput
                  ref={urlInputRef}
                  value={newUrl}
                  onChangeText={setNewUrl}
                  className="flex-1 text-[14px] text-text-primary"
                  placeholder="Website URL  (e.g. carrefour.ae)"
                  placeholderTextColor="#B0C4BC"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={canAdd ? handleAdd : undefined}
                />
              </View>
            </View>

            {/* Add button */}
            <TouchableOpacity
              onPress={handleAdd}
              disabled={!canAdd || adding}
              activeOpacity={0.85}
              className={`rounded-2xl py-4 items-center justify-center flex-row gap-2 ${
                canAdd && !adding ? 'bg-teal-600' : 'bg-teal-100'
              }`}
            >
              {adding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name="add-circle-outline"
                    size={19}
                    color={canAdd ? '#fff' : '#A8D5C5'}
                  />
                  <Text
                    className={`text-[15px] font-semibold ${
                      canAdd ? 'text-white' : 'text-teal-300'
                    }`}
                  >
                    Add store
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
