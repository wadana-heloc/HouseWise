import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const ITEMS = [
  { id: '1', name: 'Whole milk 2L',    store: 'Carrefour', price: 12.50, size: '2L',   ppu: '6.25/L',   health: 'standard', qty: 2, approved: false },
  { id: '2', name: 'Brown rice 5kg',   store: 'Lulu',      price: 34.50, size: '5kg',  ppu: '6.9/kg',   health: 'healthy',  qty: 1, approved: false },
  { id: '3', name: 'Olive oil 750ml',  store: 'Spinneys',  price: 42.00, size: '750ml',ppu: '56/L',     health: 'healthy',  qty: 1, approved: false },
  { id: '4', name: 'Greek yogurt 500g',store: 'Carrefour', price: 18.75, size: '500g', ppu: '37.5/kg',  health: 'healthy',  qty: 3, approved: false },
  { id: '5', name: 'Chicken breast 1kg',store:'Lulu',      price: 29.90, size: '1kg',  ppu: '29.9/kg',  health: 'healthy',  qty: 2, approved: false },
];

export default function WeeklyApprovalScreen() {
  const router = useRouter();
  const [items, setItems] = useState(ITEMS);
  const [submitted, setSubmitted] = useState(false);

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const approvedCount = items.filter((i) => i.approved).length;

  function toggleApprove(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, approved: !i.approved } : i)));
  }

  function handleApproveAll() {
    setItems((prev) => prev.map((i) => ({ ...i, approved: true })));
  }

  function handleSubmit() {
    Alert.alert(
      'Confirm purchase list',
      `You're confirming AED ${total.toFixed(2)} across ${new Set(items.map((i) => i.store)).size} stores. Proceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => setSubmitted(true) },
      ]
    );
  }

  if (submitted) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8">
        <View className="w-20 h-20 rounded-full bg-teal-50 items-center justify-center mb-5">
          <Ionicons name="checkmark-circle" size={56} color="#1D9E75" />
        </View>
        <Text className="text-[24px] font-medium text-text-primary text-center">List confirmed!</Text>
        <Text className="text-[14px] text-text-muted text-center mt-2 leading-6">
          Your shopping list has been finalised. Good luck at the shops!
        </Text>
        <TouchableOpacity
          className="mt-8 bg-teal-600 rounded-xl px-8 py-4"
          onPress={() => router.replace('/(tabs)/home')}
        >
          <Text className="text-[15px] font-semibold text-white">Back to home</Text>
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
            <Ionicons name="close" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Approve list</Text>
        </View>
        <TouchableOpacity onPress={handleApproveAll}>
          <Text className="text-[13px] font-medium text-teal-600">Approve all</Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      <View className="px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[12px] text-text-muted">{approvedCount}/{items.length} items approved</Text>
          <Text className="text-[14px] font-medium text-teal-600">AED {total.toFixed(2)}</Text>
        </View>
        <View className="h-1.5 bg-teal-50 rounded-full">
          <View
            className="h-1.5 bg-teal-600 rounded-full"
            style={{ width: `${(approvedCount / items.length) * 100}%` }}
          />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 10 }}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            className={`bg-white border rounded-xl px-4 py-3.5 flex-row items-center gap-3 ${item.approved ? 'border-teal-400' : 'border-border'}`}
            onPress={() => toggleApprove(item.id)}
            activeOpacity={0.8}
          >
            <View className={`w-6 h-6 rounded-md border-2 items-center justify-center ${item.approved ? 'bg-teal-600 border-teal-600' : 'border-border'}`}>
              {item.approved && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>

            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-[14px] font-medium text-text-primary">{item.name}</Text>
                {item.health === 'healthy' && (
                  <View className="bg-teal-50 rounded px-1.5 py-0.5">
                    <Text className="text-[10px] font-medium text-teal-600">Healthy</Text>
                  </View>
                )}
              </View>
              <Text className="text-[12px] text-text-faint mt-0.5">
                {item.store} · {item.size} · {item.ppu} · qty {item.qty}
              </Text>
            </View>

            <Text className="text-[14px] font-medium text-text-primary">
              AED {(item.price * item.qty).toFixed(2)}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-border px-5 py-4">
        <TouchableOpacity
          className={`rounded-xl py-4 items-center ${approvedCount === items.length ? 'bg-teal-600' : 'bg-teal-50'}`}
          onPress={approvedCount === items.length ? handleSubmit : handleApproveAll}
          activeOpacity={0.85}
        >
          <Text className={`text-[16px] font-semibold ${approvedCount === items.length ? 'text-white' : 'text-teal-600'}`}>
            {approvedCount === items.length ? 'Confirm purchase list →' : `Approve remaining ${items.length - approvedCount} items`}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}