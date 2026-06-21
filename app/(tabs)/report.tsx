import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { getToBuyList, markEntryDone, deleteEntry, type ToBuyEntry, type ToBuyListOut } from '../../services/toBuy';

export default function ReportScreen() {
  const router = useRouter();
  const { role } = useAuthStore();
  const isAdmin = role === 'admin';

  const [data, setData] = useState<ToBuyListOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  async function fetchList() {
    setLoading(true);
    setError(null);
    try {
      const list = await getToBuyList();
      setData(list);
    } catch (err: any) {
      setError('Could not load the shopping list. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      fetchList();
    }, []),
  );

  async function handleMarkDone(entry: ToBuyEntry) {
    setActionLoadingId(entry.id);
    try {
      await markEntryDone(entry.id);
      // Re-fetch to reflect cross-sync (items.status also flips)
      await fetchList();
    } catch {
      Alert.alert('Error', 'Could not mark the item as bought. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  }

  function handleDeleteEntry(entry: ToBuyEntry) {
    Alert.alert(
      'Remove from list?',
      `Remove "${entry.item_name}" from the shopping list? The item will stay in your household list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActionLoadingId(entry.id);
            try {
              await deleteEntry(entry.id);
              await fetchList();
            } catch {
              Alert.alert('Error', 'Could not remove the item. Please try again.');
            } finally {
              setActionLoadingId(null);
            }
          },
        },
      ],
    );
  }

  // ── Group entries by store ────────────────────────────────────────────────
  function groupByStore(entries: ToBuyEntry[]) {
    const map = new Map<string, ToBuyEntry[]>();
    entries.forEach((e) => {
      const existing = map.get(e.chosen_store_name) ?? [];
      existing.push(e);
      map.set(e.chosen_store_name, existing);
    });
    return map;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator size="large" color="#1D9E75" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8 gap-4">
        <View className="w-14 h-14 rounded-full bg-red-50 items-center justify-center">
          <Ionicons name="cloud-offline-outline" size={28} color="#EF4444" />
        </View>
        <Text className="text-[15px] font-medium text-text-primary text-center">{error}</Text>
        <TouchableOpacity className="bg-teal-600 rounded-xl px-6 py-3" onPress={fetchList}>
          <Text className="text-[14px] font-semibold text-white">Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isEmpty = !data || data.item_count === 0;
  const byStore = data ? groupByStore(data.entries) : new Map<string, ToBuyEntry[]>();

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center justify-between">
        <Text className="text-[22px] font-medium text-text-primary">Shopping list</Text>
        {!isEmpty && data && (
          <View className="bg-teal-50 px-3 py-1 rounded-full">
            <Text className="text-[12px] font-medium text-teal-600">
              {data.item_count} item{data.item_count !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>

      {/* Empty state */}
      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <View className="w-20 h-20 rounded-full bg-teal-50 items-center justify-center">
            <Ionicons name="cart-outline" size={36} color="#1D9E75" />
          </View>
          <Text className="text-[18px] font-medium text-text-primary text-center">
            Your shopping list is empty
          </Text>
          <Text className="text-[14px] text-text-muted text-center leading-5">
            Tap "Generate report" to compare prices and start a new shopping trip.
          </Text>
          {isAdmin && (
            <TouchableOpacity
              className="mt-2 bg-teal-600 rounded-xl px-6 py-3 flex-row items-center gap-2"
              onPress={() => router.push('/generate-report')}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles-outline" size={18} color="#fff" />
              <Text className="text-[14px] font-semibold text-white">Generate report</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          {/* Total card */}
          <View className="bg-teal-600 rounded-2xl p-4">
            <Text className="text-[13px] text-white opacity-75 mb-1">Estimated total</Text>
            <Text className="text-[32px] font-medium text-white">
              {data!.currency} {parseFloat(data!.estimated_total).toFixed(2)}
            </Text>
            <View className="flex-row gap-2 mt-3 flex-wrap">
              {Array.from(byStore.entries()).map(([store, entries]) => {
                const storeTotal = entries.reduce(
                  (sum, e) => sum + parseFloat(e.chosen_price),
                  0,
                );
                return (
                  <View key={store} className="bg-white/20 rounded-lg px-3 py-1.5">
                    <Text className="text-[12px] text-white">
                      {store}  {data!.currency} {storeTotal.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Items by store */}
          {Array.from(byStore.entries()).map(([store, entries]) => (
            <View key={store} className="bg-white border border-border rounded-xl overflow-hidden">
              {/* Store header */}
              <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="storefront-outline" size={16} color="#1D9E75" />
                  <Text className="text-[15px] font-medium text-text-primary">{store}</Text>
                </View>
                <Text className="text-[13px] font-medium text-teal-600">
                  {data!.currency}{' '}
                  {entries.reduce((s, e) => s + parseFloat(e.chosen_price), 0).toFixed(2)}
                </Text>
              </View>

              {/* Entry rows */}
              {entries.map((entry, i) => {
                const isLoading = actionLoadingId === entry.id;
                return (
                  <View
                    key={entry.id}
                    className={`px-4 py-3 flex-row items-center gap-3 ${
                      i < entries.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    {/* Mark done button */}
                    <TouchableOpacity
                      onPress={() => handleMarkDone(entry)}
                      disabled={isLoading}
                      className="w-7 h-7 rounded-full border-2 border-teal-400 items-center justify-center"
                      activeOpacity={0.7}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color="#1D9E75" />
                      ) : (
                        <Ionicons name="checkmark" size={14} color="#1D9E75" />
                      )}
                    </TouchableOpacity>

                    {/* Item info */}
                    <View className="flex-1">
                      <Text className="text-[14px] text-text-primary">{entry.item_name}</Text>
                      <Text className="text-[12px] text-text-faint mt-0.5">
                        {entry.quantity} {entry.unit}
                      </Text>
                    </View>

                    {/* Price */}
                    <Text className="text-[14px] font-medium text-text-primary">
                      {entry.currency} {parseFloat(entry.chosen_price).toFixed(2)}
                    </Text>

                    {/* Admin-only delete */}
                    {isAdmin && (
                      <TouchableOpacity
                        onPress={() => handleDeleteEntry(entry)}
                        disabled={isLoading}
                        className="w-7 h-7 items-center justify-center"
                        activeOpacity={0.7}
                      >
                        <Ionicons name="close" size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          {/* Admin: generate new report */}
          {isAdmin && (
            <TouchableOpacity
              className="border border-teal-200 rounded-xl py-3.5 flex-row items-center justify-center gap-2"
              onPress={() => router.push('/generate-report')}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles-outline" size={18} color="#1D9E75" />
              <Text className="text-[14px] font-medium text-teal-600">Generate new report</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 16 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
