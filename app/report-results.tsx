import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { sendReportEmail } from '../services/report';

// ─── Types ────────────────────────────────────────────────────────────────────
type StoreOption = {
  store: string;
  productName: string;
  price: number;
  size: string;
  pricePerUnit: string;
  healthBadge?: 'healthy' | 'standard';
  available: boolean;
};

type ReportItem = {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  requestedBy: string;
  options: StoreOption[];      // already sorted cheapest → expensive
  selectedOption: StoreOption | null;
};

// ─── Mock AI response (replace with real API response) ───────────────────────
// This mirrors the JSON structure your backend returns:
// { "orange juice": [{ store, price, size, pricePerUnit }, ...] }
const MOCK_RESULTS: ReportItem[] = [
  {
    id: '1',
    itemName: 'Orange juice',
    qty: 2,
    unit: 'bottles',
    requestedBy: 'Sara',
    selectedOption: null,
    options: [
      { store: 'Union Coop', productName: 'Tropicana Orange 1L',      price: 10.50, size: '1L',   pricePerUnit: '10.5/L',  healthBadge: 'healthy',  available: true  },
      { store: 'Lulu',       productName: 'Almarai Orange Juice 1L',  price: 12.00, size: '1L',   pricePerUnit: '12/L',    healthBadge: 'standard', available: true  },
      { store: 'Carrefour',  productName: 'Minute Maid 1L',           price: 13.25, size: '1L',   pricePerUnit: '13.25/L', healthBadge: 'standard', available: true  },
      { store: 'Spinneys',   productName: 'Tropicana Premium 1.5L',   price: 15.75, size: '1.5L', pricePerUnit: '10.5/L',  healthBadge: 'healthy',  available: true  },
      { store: 'Carrefour',  productName: 'Carrefour Brand OJ 2L',    price: 18.00, size: '2L',   pricePerUnit: '9/L',     healthBadge: 'standard', available: true  },
    ],
  },
  {
    id: '2',
    itemName: 'Tomatoes 1kg',
    qty: 1,
    unit: 'kg',
    requestedBy: 'Ahmad',
    selectedOption: null,
    options: [
      { store: 'Lulu',      productName: 'Fresh Tomatoes 1kg',        price: 4.50,  size: '1kg',  pricePerUnit: '4.5/kg',  healthBadge: 'healthy',  available: true  },
      { store: 'Union Coop',productName: 'Local Tomatoes 1kg',        price: 5.25,  size: '1kg',  pricePerUnit: '5.25/kg', healthBadge: 'healthy',  available: true  },
      { store: 'Carrefour', productName: 'Carrefour Tomatoes 1kg',    price: 6.00,  size: '1kg',  pricePerUnit: '6/kg',    healthBadge: 'healthy',  available: true  },
      { store: 'Spinneys',  productName: 'Organic Tomatoes 500g x2',  price: 8.50,  size: '500g x2', pricePerUnit: '8.5/kg', healthBadge: 'healthy', available: true },
      { store: 'Carrefour', productName: 'Cherry Tomatoes 500g',      price: 9.75,  size: '500g', pricePerUnit: '19.5/kg', healthBadge: 'healthy',  available: true  },
    ],
  },
  {
    id: '3',
    itemName: 'Whole milk 2L',
    qty: 2,
    unit: 'units',
    requestedBy: 'Maha',
    selectedOption: null,
    options: [
      { store: 'Lulu',      productName: 'Almarai Full Fat 2L',       price: 9.75,  size: '2L',   pricePerUnit: '4.88/L',  healthBadge: 'standard', available: true  },
      { store: 'Carrefour', productName: 'Baladna Full Cream 2L',     price: 10.50, size: '2L',   pricePerUnit: '5.25/L',  healthBadge: 'standard', available: true  },
      { store: 'Union Coop',productName: 'Union Coop Fresh Milk 2L',  price: 10.75, size: '2L',   pricePerUnit: '5.38/L',  healthBadge: 'standard', available: true  },
      { store: 'Spinneys',  productName: 'Organic Valley Milk 2L',    price: 14.50, size: '2L',   pricePerUnit: '7.25/L',  healthBadge: 'healthy',  available: true  },
      { store: 'Spinneys',  productName: 'Arla Organic Milk 1L x2',   price: 17.00, size: '1L x2',pricePerUnit: '8.5/L',   healthBadge: 'healthy',  available: true  },
    ],
  },
  {
    id: '4',
    itemName: 'Chicken breast',
    qty: 1,
    unit: 'kg',
    requestedBy: 'Sara',
    selectedOption: null,
    options: [
      { store: 'Lulu',      productName: 'Fresh Chicken Breast 1kg',  price: 28.50, size: '1kg',  pricePerUnit: '28.5/kg', healthBadge: 'healthy',  available: true  },
      { store: 'Carrefour', productName: 'Frozen Chicken Breast 1kg', price: 29.00, size: '1kg',  pricePerUnit: '29/kg',   healthBadge: 'standard', available: true  },
      { store: 'Union Coop',productName: 'Local Chicken Breast 1kg',  price: 30.00, size: '1kg',  pricePerUnit: '30/kg',   healthBadge: 'healthy',  available: true  },
      { store: 'Spinneys',  productName: 'Organic Chicken Breast 1kg',price: 38.00, size: '1kg',  pricePerUnit: '38/kg',   healthBadge: 'healthy',  available: true  },
      { store: 'Spinneys',  productName: 'Free Range Chicken 1kg',    price: 42.00, size: '1kg',  pricePerUnit: '42/kg',   healthBadge: 'healthy',  available: true  },
    ],
  },
];

// ─── WhatsApp message formatter ───────────────────────────────────────────────
function buildWhatsAppMessage(items: ReportItem[]): string {
  const confirmed = items.filter((i) => i.selectedOption !== null);
  if (confirmed.length === 0) return '';

  // Group by store
  const byStore: Record<string, { item: string; qty: string; price: number }[]> = {};
  confirmed.forEach((item) => {
    const opt = item.selectedOption!;
    if (!byStore[opt.store]) byStore[opt.store] = [];
    byStore[opt.store].push({
      item: item.itemName,
      qty: `${item.qty} ${item.unit}`,
      price: opt.price * item.qty,
    });
  });

  let msg = '🛒 *HouseWise Shopping List*\n\n';
  let grandTotal = 0;

  Object.entries(byStore).forEach(([store, storeItems]) => {
    const storeTotal = storeItems.reduce((sum, i) => sum + i.price, 0);
    grandTotal += storeTotal;
    msg += `🏪 *${store}*\n`;
    storeItems.forEach((i) => {
      msg += `  • ${i.item} (${i.qty}) — AED ${i.price.toFixed(2)}\n`;
    });
    msg += `  _Subtotal: AED ${storeTotal.toFixed(2)}_\n\n`;
  });

  msg += `💰 *Grand total: AED ${grandTotal.toFixed(2)}*`;
  return msg;
}

export default function ReportResultsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ReportItem[]>(MOCK_RESULTS);
  const [isSending, setIsSending] = useState(false);

  const selectedCount = items.filter((i) => i.selectedOption !== null).length;
  const allSelected   = selectedCount === items.length;
  const grandTotal    = items
    .filter((i) => i.selectedOption !== null)
    .reduce((sum, i) => sum + i.selectedOption!.price * i.qty, 0);

  function selectOption(itemId: string, option: StoreOption) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, selectedOption: option } : i))
    );
  }

  async function handleSendWhatsApp() {
    if (!allSelected) {
      Alert.alert(
        'Incomplete selections',
        `Please select an option for all ${items.length} items before sending.`
      );
      return;
    }

    const message = buildWhatsAppMessage(items);
    const encoded = encodeURIComponent(message);
    const url     = `whatsapp://send?text=${encoded}`;
    const webUrl  = `https://wa.me/?text=${encoded}`;

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      // WhatsApp not installed — fallback to web or clipboard
      Alert.alert(
        'WhatsApp not found',
        'WhatsApp is not installed. Would you like to open WhatsApp Web instead?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Web', onPress: () => Linking.openURL(webUrl) },
        ]
      );
    }
  }

  function handleConfirmReport() {
    if (!allSelected) {
      Alert.alert(
        'Incomplete selections',
        `Please select a store option for all ${items.length} items.`
      );
      return;
    }
    Alert.alert(
      'Confirm report',
      `Confirm purchase of ${items.length} items totalling AED ${grandTotal.toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Send',
          onPress: () => {
            handleSendWhatsApp();
          },
        },
      ]
    );
  }

  async function handleSendEmail() {
    if (!allSelected) {
      Alert.alert(
        'Incomplete selections',
        `Please select an option for all ${items.length} items before sending.`
      );
      return;
    }

    Alert.alert(
      'Send to Admin',
      `Send the shopping report (AED ${grandTotal.toFixed(2)}) to the household admin?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setIsSending(true);
            try {
              const confirmed = items.filter((i) => i.selectedOption !== null);
              await sendReportEmail({
                items: confirmed.map((i) => ({
                  itemName: i.itemName,
                  qty: i.qty,
                  unit: i.unit,
                  requestedBy: i.requestedBy,
                  selectedOption: i.selectedOption!,
                })),
                grandTotal,
              });
              Alert.alert(
                'Report sent!',
                'The shopping report has been emailed to the admin.',
                [{ text: 'OK', onPress: () => router.back() }]
              );
            } catch {
              Alert.alert('Failed to send', 'Could not send the report. Please try again.');
            } finally {
              setIsSending(false);
            }
          },
        },
      ]
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

      {/* Progress */}
      <View className="px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[12px] text-text-muted">Select one option per item</Text>
          {grandTotal > 0 && (
            <Text className="text-[14px] font-medium text-teal-600">
              AED {grandTotal.toFixed(2)} so far
            </Text>
          )}
        </View>
        <View className="h-1.5 bg-teal-50 rounded-full">
          <View
            className="h-1.5 bg-teal-600 rounded-full"
            style={{ width: `${(selectedCount / items.length) * 100}%` }}
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
                <Text className="text-[15px] font-medium text-text-primary">{item.itemName}</Text>
                <Text className="text-[12px] text-text-muted mt-0.5">
                  {item.requestedBy} · {item.qty} {item.unit}
                </Text>
              </View>
              {item.selectedOption ? (
                <View className="bg-teal-50 rounded-lg px-2.5 py-1">
                  <Text className="text-[11px] font-medium text-teal-600">
                    ✓ {item.selectedOption.store}
                  </Text>
                </View>
              ) : (
                <View className="bg-amber-100 rounded-lg px-2.5 py-1">
                  <Text className="text-[11px] font-medium text-amber-800">Choose option</Text>
                </View>
              )}
            </View>

            {/* Options — sorted cheapest first */}
            <View className="gap-2">
              {item.options.map((opt, idx) => {
                const isSelected =
                  item.selectedOption?.store === opt.store &&
                  item.selectedOption?.productName === opt.productName;
                const isCheapest = idx === 0;

                return (
                  <TouchableOpacity
                    key={`${opt.store}-${opt.productName}`}
                    className={`bg-white rounded-xl px-4 py-3 flex-row items-center gap-3 border ${
                      isSelected ? 'border-teal-400' : 'border-border'
                    }`}
                    onPress={() => selectOption(item.id, opt)}
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
                          {opt.store}
                        </Text>
                        {isCheapest && (
                          <View className="bg-teal-50 rounded px-1.5 py-0.5">
                            <Text className="text-[10px] font-medium text-teal-600">Cheapest</Text>
                          </View>
                        )}
                        {opt.healthBadge === 'healthy' && (
                          <View className="bg-green-50 rounded px-1.5 py-0.5">
                            <Text className="text-[10px] font-medium text-green-600">Healthy</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-[12px] text-text-faint mt-0.5" numberOfLines={1}>
                        {opt.productName} · {opt.size}
                      </Text>
                      <Text className="text-[11px] text-text-faint">{opt.pricePerUnit}</Text>
                    </View>

                    {/* Price */}
                    <View className="items-end">
                      <Text className="text-[15px] font-medium text-text-primary">
                        AED {opt.price.toFixed(2)}
                      </Text>
                      {item.qty > 1 && (
                        <Text className="text-[11px] text-text-faint">
                          × {item.qty} = AED {(opt.price * item.qty).toFixed(2)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-border px-5 py-4 gap-3">
        {grandTotal > 0 && (
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-[13px] text-text-muted">
              {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
            </Text>
            <Text className="text-[16px] font-medium text-text-primary">
              Total: AED {grandTotal.toFixed(2)}
            </Text>
          </View>
        )}

        {/* Primary: Send to admin email */}
        <TouchableOpacity
          className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${
            allSelected && !isSending ? 'bg-teal-600' : 'bg-teal-50'
          }`}
          onPress={handleSendEmail}
          disabled={isSending}
          activeOpacity={0.85}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name="mail"
              size={20}
              color={allSelected ? '#fff' : '#A8C4B8'}
            />
          )}
          <Text
            className={`text-[16px] font-semibold ${
              allSelected && !isSending ? 'text-white' : 'text-text-faint'
            }`}
          >
            {isSending
              ? 'Sending...'
              : allSelected
              ? 'Send to Admin'
              : `Select ${items.length - selectedCount} more item${items.length - selectedCount !== 1 ? 's' : ''}`}
          </Text>
        </TouchableOpacity>

        {/* Secondary: WhatsApp */}
        {allSelected && (
          <TouchableOpacity
            className="rounded-xl py-3 flex-row items-center justify-center gap-2 border border-teal-200"
            onPress={handleConfirmReport}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-whatsapp" size={18} color="#1D9E75" />
            <Text className="text-[14px] font-medium text-teal-600">
              Share via WhatsApp
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}