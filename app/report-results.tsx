import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useReportStore, type ReportStoreItem } from '../store/reportStore';
import { saveToBuyList, getToBuyList, type PriceOption } from '../services/toBuy';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SelectedOption = {
  store_url: string;
  store_name: string;
  price: number;
  product_name: string | null;
  unit_price: number | null;
  unit: string | null;
  is_cheapest: boolean;
};

type AvailableOption = Omit<PriceOption, 'price'> & {
  price: number; // null prices are filtered out in buildUIItems
  is_cheapest: boolean;
};

type UIItem = ReportStoreItem & {
  selectedOption: SelectedOption | null;
  availableOptions: AvailableOption[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildUIItems(storeItems: ReportStoreItem[]): UIItem[] {
  return storeItems.map((item) => {
    const withPrice = item.priceResult.prices.filter(
      (p): p is PriceOption & { price: number } => p.price !== null,
    );
    // Sort cheapest first
    withPrice.sort((a, b) => a.price - b.price);

    const cheapestUrl = item.priceResult.cheapest_store_url;
    const availableOptions = withPrice.map((p) => ({
      ...p,
      is_cheapest: p.store_url === cheapestUrl,
    }));

    return {
      ...item,
      availableOptions,
      selectedOption: null,
    };
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ReportResultsScreen() {
  const router = useRouter();
  const { items: storeItems, existingToBuyCount, clear } = useReportStore();
  const [items, setItems] = useState<UIItem[]>(() => buildUIItems(storeItems));
  const [isSaving, setIsSaving] = useState(false);

  const selectedCount = items.filter((i) => i.selectedOption !== null).length;
  const selectableCount = items.filter((i) => i.availableOptions.length > 0).length;
  const hasSelection = selectedCount > 0;
  const grandTotal = items
    .filter((i) => i.selectedOption !== null)
    .reduce((sum, i) => sum + i.selectedOption!.price, 0);

  function selectOption(itemId: string, option: SelectedOption) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, selectedOption: option } : i)),
    );
  }

  async function doSave() {
    setIsSaving(true);
    try {
      const entries = items
        .filter((i) => i.selectedOption !== null)
        .map((i) => ({
          item_id: i.id,
          chosen_store_url: i.selectedOption!.store_url,
          chosen_store_name: i.selectedOption!.store_name,
          chosen_price: i.selectedOption!.price.toFixed(2),
          currency: 'AED',
        }));

      await saveToBuyList(entries);
      clear();
      router.replace('/(tabs)/report');
    } catch {
      Alert.alert('Failed to save', 'Could not save the shopping list. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function doAppend() {
    setIsSaving(true);
    try {
      const newEntries = items
        .filter((i) => i.selectedOption !== null)
        .map((i) => ({
          item_id: i.id,
          chosen_store_url: i.selectedOption!.store_url,
          chosen_store_name: i.selectedOption!.store_name,
          chosen_price: i.selectedOption!.price.toFixed(2),
          currency: 'AED',
        }));

      const newItemIds = new Set(newEntries.map((e) => e.item_id));
      const existing = await getToBuyList();
      const existingEntries = existing.entries
        .filter((e) => !newItemIds.has(e.item_id))
        .map((e) => ({
          item_id: e.item_id,
          chosen_store_url: e.chosen_store_url,
          chosen_store_name: e.chosen_store_name,
          chosen_price: e.chosen_price,
          currency: e.currency,
        }));

      await saveToBuyList([...existingEntries, ...newEntries]);
      clear();
      router.replace('/(tabs)/report');
    } catch {
      Alert.alert('Failed to save', 'Could not update the shopping list. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleSave() {
    if (existingToBuyCount > 0) {
      Alert.alert(
        'Shopping list already exists',
        `You have ${existingToBuyCount} item${existingToBuyCount !== 1 ? 's' : ''} on your shopping list. What would you like to do?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add to existing', onPress: doAppend },
          { text: 'Replace', style: 'destructive', onPress: doSave },
        ],
      );
    } else {
      doSave();
    }
  }

  // Empty / loading guard
  if (storeItems.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8">
        <Text className="text-[15px] text-text-muted text-center">
          No price results. Go back and try again.
        </Text>
        <TouchableOpacity
          className="mt-6 bg-teal-600 rounded-xl px-6 py-3"
          onPress={() => router.back()}
        >
          <Text className="text-[14px] font-semibold text-white">Go back</Text>
        </TouchableOpacity>
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
          <Text className="text-[20px] font-medium text-text-primary">Price results</Text>
        </View>
        <Text className="text-[13px] text-text-muted">
          {selectedCount}/{items.length} selected
        </Text>
      </View>

      {/* Progress bar */}
      <View className="px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[12px] text-text-muted">Select one store per item</Text>
          {grandTotal > 0 && (
            <Text className="text-[14px] font-medium text-teal-600">
              AED {grandTotal.toFixed(2)} so far
            </Text>
          )}
        </View>
        <View className="h-1.5 bg-teal-50 rounded-full">
          <View
            className="h-1.5 bg-teal-600 rounded-full"
            style={{ width: `${selectableCount > 0 ? (selectedCount / selectableCount) * 100 : 0}%` }}
          />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 16 }}
      >
        {items.map((item) => (
          <View key={item.id} className="gap-2">
            {/* Item header */}
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-[15px] font-medium text-text-primary">{item.name}</Text>
                <Text className="text-[12px] text-text-muted mt-0.5">
                  {item.quantity} {item.unit}
                </Text>
              </View>
              {item.selectedOption ? (
                <View className="bg-teal-50 rounded-lg px-2.5 py-1">
                  <Text className="text-[11px] font-medium text-teal-600">
                    ✓ {item.selectedOption.store_name}
                  </Text>
                </View>
              ) : (
                <View className="bg-amber-100 rounded-lg px-2.5 py-1">
                  <Text className="text-[11px] font-medium text-amber-800">Choose store</Text>
                </View>
              )}
            </View>

            {/* No prices found for this item */}
            {item.availableOptions.length === 0 && (
              <View className="bg-white border border-border rounded-xl px-4 py-3">
                <Text className="text-[13px] text-text-muted">
                  No prices found for this item across any store.
                </Text>
              </View>
            )}

            {/* Store options */}
            <View className="gap-2">
              {item.availableOptions.map((opt) => {
                const isSelected =
                  item.selectedOption?.store_url === opt.store_url &&
                  item.selectedOption?.product_name === opt.product_name_as_found;

                return (
                  <TouchableOpacity
                    key={`${opt.store_url}-${opt.product_name_as_found}`}
                    className={`bg-white rounded-xl px-4 py-3 flex-row items-center gap-3 border ${
                      isSelected ? 'border-teal-400' : 'border-border'
                    }`}
                    onPress={() =>
                      selectOption(item.id, {
                        store_url: opt.store_url,
                        store_name: opt.store_name,
                        price: opt.price,
                        product_name: opt.product_name_as_found,
                        unit_price: opt.unit_price,
                        unit: opt.unit,
                        is_cheapest: opt.is_cheapest,
                      })
                    }
                    activeOpacity={0.75}
                  >
                    {/* Radio */}
                    <View
                      className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                        isSelected ? 'border-teal-600' : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <View className="w-2.5 h-2.5 rounded-full bg-teal-600" />
                      )}
                    </View>

                    {/* Info */}
                    <View className="flex-1">
                      <View className="flex-row items-center gap-1.5 flex-wrap">
                        <Text className="text-[13px] font-medium text-text-primary">
                          {opt.store_name}
                        </Text>
                        {opt.is_cheapest && (
                          <View className="bg-teal-50 rounded px-1.5 py-0.5">
                            <Text className="text-[10px] font-medium text-teal-600">Cheapest</Text>
                          </View>
                        )}
                      </View>
                      {opt.product_name_as_found && (
                        <Text
                          className="text-[12px] text-text-faint mt-0.5"
                          numberOfLines={1}
                        >
                          {opt.product_name_as_found}
                        </Text>
                      )}
                      {opt.unit_price !== null && opt.unit && (
                        <Text className="text-[11px] text-text-faint">
                          AED {opt.unit_price.toFixed(2)}/{opt.unit}
                        </Text>
                      )}
                    </View>

                    {/* Price */}
                    <Text className="text-[15px] font-medium text-text-primary">
                      AED {opt.price.toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-border px-5 py-4">
        {grandTotal > 0 && (
          <View className="flex-row items-center justify-between px-1 mb-3">
            <Text className="text-[13px] text-text-muted">
              {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
            </Text>
            <Text className="text-[16px] font-medium text-text-primary">
              Total: AED {grandTotal.toFixed(2)}
            </Text>
          </View>
        )}

        <TouchableOpacity
          className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${
            hasSelection && !isSaving ? 'bg-teal-600' : 'bg-teal-50'
          }`}
          onPress={handleSave}
          disabled={!hasSelection || isSaving}
          activeOpacity={0.85}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name="bag-check-outline"
              size={20}
              color={hasSelection ? '#fff' : '#A8C4B8'}
            />
          )}
          <Text
            className={`text-[16px] font-semibold ${
              hasSelection && !isSaving ? 'text-white' : 'text-text-faint'
            }`}
          >
            {isSaving
              ? 'Saving...'
              : hasSelection
              ? `Save ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`
              : 'Select at least one item'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
