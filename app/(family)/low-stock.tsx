import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StatusBar, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { useLowStockStore } from '../../store/lowStockStore';
import { useAuthStore } from '../../store/authStore';

export default function FamilyLowStockScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const { flags, loading, error, fetchFlags, addFlag, deleteFlag } = useLowStockStore();
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchFlags();
  }, []);

  async function handleAdd() {
    const name = newItem.trim();
    if (!name) return;
    setAdding(true);
    try {
      await addFlag(name);
      setNewItem('');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        Alert.alert('Already flagged', 'This item is already on the low-stock list.');
      } else if (status === 422) {
        Alert.alert('Invalid name', 'Item name must be between 1 and 120 characters.');
      } else {
        Alert.alert('Error', 'Failed to add flag. Please try again.');
      }
    } finally {
      setAdding(false);
    }
  }

  function handleDelete(id: string, name: string) {
    Alert.alert('Remove flag', `Remove "${name}" from low-stock?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFlag(id);
          } catch {
            Alert.alert('Error', 'Failed to remove flag. Please try again.');
          }
        },
      },
    ]);
  }

  function handleAddToList(flagId: string, flagName: string) {
    router.push({
      pathname: '/(family)/add-item',
      params: { prefillName: flagName, lowStockFlagId: flagId },
    } as any);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="text-[20px] font-medium text-text-primary">Low stock</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16 }}>

        {/* Info banner */}
        <View className="bg-amber-100 border border-amber-400/30 rounded-xl p-4 flex-row items-start gap-3">
          <Ionicons name="information-circle-outline" size={20} color="#92400E" />
          <Text className="flex-1 text-[13px] text-amber-800 leading-5">
            Flag items running low. Tap "Add to list" to add them to the shopping list with details like quantity and unit.
          </Text>
        </View>

        {/* Inline flag */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Flag an item</Text>
          <View className="flex-row gap-2.5">
            <TextInput
              className="flex-1 bg-white border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
              placeholder="Item running low..."
              placeholderTextColor="#A8C4B8"
              value={newItem}
              onChangeText={setNewItem}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              editable={!adding}
            />
            <TouchableOpacity
              className={`rounded-xl px-4 items-center justify-center ${adding ? 'bg-teal-400' : 'bg-teal-600'}`}
              onPress={handleAdd}
              activeOpacity={0.85}
              disabled={adding}
            >
              {adding
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add" size={22} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* List */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">
            Flagged items ({flags.length})
          </Text>

          {loading && (
            <View className="py-8 items-center">
              <ActivityIndicator size="small" color="#1D9E75" />
            </View>
          )}

          {!loading && error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-4">
              <Text className="text-[13px] text-red-700">{error}</Text>
            </View>
          )}

          {!loading && !error && flags.length === 0 && (
            <View className="bg-white border border-border rounded-xl p-6 items-center gap-2">
              <Ionicons name="checkmark-circle-outline" size={32} color="#A8C4B8" />
              <Text className="text-[14px] text-text-muted text-center">No items flagged. Everything looks stocked up!</Text>
            </View>
          )}

          {flags.map((flag) => {
            const canDelete = flag.added_by === userId;
            return (
              <View key={flag.id} className="bg-white border border-border rounded-xl px-4 py-3 gap-2">
                <View className="flex-row items-center gap-3">
                  <View className="w-2 h-2 rounded-full bg-amber-400" />
                  <Text className="flex-1 text-[14px] font-medium text-text-primary">{flag.name}</Text>
                  {canDelete && (
                    <TouchableOpacity onPress={() => handleDelete(flag.id, flag.name)} hitSlop={8}>
                      <Ionicons name="close-circle-outline" size={20} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                <Text className="text-[12px] text-text-faint pl-5" numberOfLines={1}>
                  Flagged by {flag.added_by_display_name} · {formatDistanceToNow(new Date(flag.created_at), { addSuffix: true })}
                </Text>
                <View className="pl-5 items-end">
                  <TouchableOpacity
                    className="bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5"
                    onPress={() => handleAddToList(flag.id, flag.name)}
                    hitSlop={4}
                    activeOpacity={0.75}
                  >
                    <Text className="text-[12px] font-semibold text-teal-700">+ Add to list</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
