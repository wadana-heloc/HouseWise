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
import { useItemStore } from '../store/itemStore';
import { useAuthStore } from '../store/authStore';

export default function GenerateReportScreen() {
  const router = useRouter();
  const { items, loading, error, fetchItems } = useItemStore();
  const { userId } = useAuthStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Items eligible for price comparison: anything not yet done
  const reportItems = items.filter((i) => i.status !== 'done');

  useFocusEffect(
    useCallback(() => {
      fetchItems().then(() => {
        // Auto-select all eligible items on first load
        setSelected(new Set(reportItems.map((i) => i.id)));
      });
    }, []),
  );

  // Keep selection in sync if items change (e.g. after fetch)
  useFocusEffect(
    useCallback(() => {
      setSelected(new Set(reportItems.map((i) => i.id)));
    }, [items]),
  );

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === reportItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(reportItems.map((i) => i.id)));
    }
  }

  async function handleGenerate() {
    if (selected.size === 0) {
      Alert.alert('No items selected', 'Please select at least one item to generate a report.');
      return;
    }

    setGenerating(true);
    setLoadingMessage('Connecting to stores...');

    try {
      const messages = [
        'Searching Carrefour...',
        'Searching Lulu...',
        'Searching Union Coop...',
        'Searching Spinneys...',
        'Comparing prices...',
        'Building report...',
      ];
      for (const msg of messages) {
        setLoadingMessage(msg);
        await new Promise((r) => setTimeout(r, 600));
      }

      // TODO: replace with real agent call
      // const selectedIds = Array.from(selected);
      // await reportService.runAgent({ itemIds: selectedIds });
      // const report = await reportService.getLatest();
      // router.push({ pathname: '/report-results', params: { reportId: report.id } });

      router.push('/report-results');
    } catch {
      Alert.alert(
        'Generation failed',
        'Could not fetch prices from stores. Please check your connection and try again.',
        [{ text: 'OK' }],
      );
    } finally {
      setGenerating(false);
      setLoadingMessage('');
    }
  }

  // ── Generating overlay ────────────────────────────────────────────────────
  if (generating) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8">
        <View className="w-20 h-20 rounded-full bg-teal-50 items-center justify-center mb-6">
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
        <Text className="text-[18px] font-medium text-text-primary text-center">
          Searching stores...
        </Text>
        <Text className="text-[14px] text-text-muted text-center mt-2">{loadingMessage}</Text>
        <View className="mt-8 w-full bg-white border border-border rounded-xl px-4 py-3">
          <Text className="text-[12px] text-text-muted uppercase tracking-wider mb-2">
            Checking {selected.size} items across 4 stores
          </Text>
          {['Carrefour', 'Lulu', 'Union Coop', 'Spinneys'].map((store) => (
            <View key={store} className="flex-row items-center gap-2 py-1.5">
              <View className="w-2 h-2 rounded-full bg-teal-400" />
              <Text className="text-[13px] text-text-secondary">{store}</Text>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Generate report</Text>
        </View>
        {reportItems.length > 0 && !loading && (
          <TouchableOpacity onPress={toggleAll}>
            <Text className="text-[13px] font-medium text-teal-600">
              {selected.size === reportItems.length ? 'Deselect all' : 'Select all'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Info banner */}
      <View className="mx-5 mt-4 bg-teal-50 border border-border rounded-xl px-4 py-3 flex-row items-start gap-3">
        <Ionicons name="sparkles-outline" size={18} color="#1D9E75" />
        <Text className="flex-1 text-[13px] text-teal-600 leading-5">
          Select items to compare prices across Carrefour, Lulu, Union Coop, and Spinneys.
          The AI will return the 5 best options per item sorted by price.
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 8 }}
      >
        {/* Loading state */}
        {loading && (
          <View className="items-center py-16 gap-3">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[14px] text-text-muted">Loading items…</Text>
          </View>
        )}

        {/* Error state */}
        {!loading && error && (
          <View className="items-center py-12 gap-4">
            <View className="w-14 h-14 rounded-full bg-red-50 items-center justify-center">
              <Ionicons name="cloud-offline-outline" size={28} color="#EF4444" />
            </View>
            <Text className="text-[15px] font-medium text-text-primary text-center">{error}</Text>
            <TouchableOpacity className="bg-teal-600 rounded-xl px-6 py-3" onPress={fetchItems}>
              <Text className="text-[14px] font-semibold text-white">Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty state */}
        {!loading && !error && reportItems.length === 0 && (
          <View className="items-center py-16 gap-3">
            <View className="w-16 h-16 rounded-full bg-teal-50 items-center justify-center">
              <Ionicons name="basket-outline" size={32} color="#1D9E75" />
            </View>
            <Text className="text-[16px] font-medium text-text-primary">No pending items</Text>
            <Text className="text-[13px] text-text-muted text-center px-8">
              All items are marked as done. Add new items to the shopping list first.
            </Text>
          </View>
        )}

        {/* Items list */}
        {!loading && !error && reportItems.length > 0 && (
          <>
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-1">
              Pending items ({reportItems.length})
            </Text>

            {reportItems.map((item) => {
              const isSelected = selected.has(item.id);
              const isOwn = item.added_by === userId;

              return (
                <TouchableOpacity
                  key={item.id}
                  className={`bg-white rounded-xl px-4 py-3.5 flex-row items-center gap-3 border ${
                    isSelected ? 'border-teal-400' : 'border-border'
                  }`}
                  onPress={() => toggleItem(item.id)}
                  activeOpacity={0.75}
                >
                  {/* Checkbox */}
                  <View
                    className={`w-6 h-6 rounded-md border-2 items-center justify-center ${
                      isSelected ? 'bg-teal-600 border-teal-600' : 'border-border'
                    }`}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>

                  {/* Info */}
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Text className="text-[14px] font-medium text-text-primary">{item.name}</Text>
                      {item.urgent && (
                        <View className="bg-amber-100 rounded px-1.5 py-0.5">
                          <Text className="text-[10px] font-medium text-amber-800">Urgent</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-[12px] text-text-faint mt-0.5">
                      {isOwn ? 'You' : 'Member'} · {item.quantity} {item.unit}
                    </Text>
                  </View>

                  <Ionicons
                    name="storefront-outline"
                    size={16}
                    color={isSelected ? '#1D9E75' : '#D6EDE5'}
                  />
                </TouchableOpacity>
              );
            })}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky generate button */}
      {!loading && !error && reportItems.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-border px-5 py-4">
          <TouchableOpacity
            className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${
              selected.size > 0 ? 'bg-teal-600' : 'bg-teal-50'
            }`}
            onPress={handleGenerate}
            activeOpacity={0.85}
            disabled={selected.size === 0}
          >
            <Ionicons
              name="sparkles-outline"
              size={20}
              color={selected.size > 0 ? '#fff' : '#A8C4B8'}
            />
            <Text
              className={`text-[16px] font-semibold ${
                selected.size > 0 ? 'text-white' : 'text-text-faint'
              }`}
            >
              {selected.size > 0
                ? `Compare prices for ${selected.size} item${selected.size > 1 ? 's' : ''}`
                : 'Select items to continue'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
