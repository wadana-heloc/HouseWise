import { useState } from 'react';
import { View, Text, ScrollView, StatusBar, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';

const DEFAULT_STORES = [
  { id: '1', name: 'Carrefour UAE' },
  { id: '2', name: 'Lulu Hypermarket' },
  { id: '3', name: 'Union Coop' },
  { id: '4', name: 'Spinneys' },
];

export default function PreferredStoresScreen() {
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
  const [stores, setStores] = useState(DEFAULT_STORES);
  const [newStoreName, setNewStoreName] = useState('');

  function handleAdd() {
    const trimmed = newStoreName.trim();
    if (!trimmed) return;
    if (stores.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert('Already added', `"${trimmed}" is already in your list.`);
      return;
    }
    setStores((prev) => [...prev, { id: Date.now().toString(), name: trimmed }]);
    setNewStoreName('');
  }

  function handleRemove(id: string) {
    const store = stores.find((s) => s.id === id);
    Alert.alert(
      'Remove store',
      `Remove "${store?.name}" from preferred stores?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => setStores((prev) => prev.filter((s) => s.id !== id)),
        },
      ],
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Preferred stores</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16 }}
      >
        <Text className="text-[13px] text-text-muted px-1">
          Your household's AI compares prices at these stores only.
        </Text>

        {stores.length > 0 ? (
          <View className="bg-white border border-border rounded-xl overflow-hidden">
            {stores.map((store, i) => (
              <View
                key={store.id}
                className={`flex-row items-center px-4 py-3.5 gap-3 ${i < stores.length - 1 ? 'border-b border-border' : ''}`}
              >
                <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                  <Ionicons name="storefront-outline" size={17} color="#1D9E75" />
                </View>
                <Text className="flex-1 text-[14px] text-text-primary">{store.name}</Text>
                {isAdmin && (
                  <TouchableOpacity
                    onPress={() => handleRemove(store.id)}
                    hitSlop={8}
                    className="w-7 h-7 items-center justify-center"
                  >
                    <Ionicons name="trash-outline" size={16} color="#E24B4A" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View className="bg-white border border-border rounded-xl py-10 items-center gap-2">
            <Ionicons name="storefront-outline" size={28} color="#D6EDE5" />
            <Text className="text-[13px] text-text-muted">No stores added yet</Text>
          </View>
        )}

        {/* Add store — admin only */}
        {isAdmin && (
          <View>
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 px-1">
              Add a store
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                value={newStoreName}
                onChangeText={setNewStoreName}
                className="flex-1 bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                placeholder="e.g. Waitrose, IKEA Food"
                placeholderTextColor="#B0C4BC"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              <TouchableOpacity
                className={`w-12 rounded-xl items-center justify-center ${newStoreName.trim() ? 'bg-teal-600' : 'bg-teal-100'}`}
                onPress={handleAdd}
                disabled={!newStoreName.trim()}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={22} color={newStoreName.trim() ? '#fff' : '#A8D5C5'} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
