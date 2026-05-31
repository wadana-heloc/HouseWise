import { useState } from 'react';
import { View, Text, TouchableOpacity, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

// Mock product that gets "found" after scan
const MOCK_PRODUCT = {
  name: 'Almarai Full Fat Milk',
  brand: 'Almarai',
  size: '2L',
  barcode: '6281007030275',
  category: 'Dairy',
  image: null,
};

type Stage = 'scanning' | 'found' | 'not-found';

export default function BarcodeScanScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('scanning');
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState(1);

  function simulateScan() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStage('found');
    }, 1500);
  }

  function handleAdd() {
    Alert.alert('Item added', `${MOCK_PRODUCT.name} (qty ${qty}) has been added to your shopping list.`, [
      { text: 'Scan another', onPress: () => { setStage('scanning'); setQty(1); } },
      { text: 'Go to list', onPress: () => router.push('/(tabs)/list') },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="text-[20px] font-medium text-text-primary">Scan barcode</Text>
      </View>

      <View className="flex-1 px-5 justify-center gap-6">

        {/* Camera frame mock */}
        <View className="bg-white border border-border rounded-2xl overflow-hidden items-center justify-center" style={{ height: 240 }}>
          {stage === 'scanning' && !loading && (
            <View className="items-center gap-4">
              <View className="w-48 h-32 border-2 border-teal-400 rounded-xl items-center justify-center">
                <View className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-teal-600 rounded-tl-md" />
                <View className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-teal-600 rounded-tr-md" />
                <View className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-teal-600 rounded-bl-md" />
                <View className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-teal-600 rounded-br-md" />
                <Text className="text-[12px] text-text-muted text-center px-4">Point camera at barcode</Text>
              </View>
              <Text className="text-[13px] text-text-faint">Camera preview appears here</Text>
            </View>
          )}
          {loading && (
            <View className="items-center gap-3">
              <ActivityIndicator size="large" color="#1D9E75" />
              <Text className="text-[13px] text-text-muted">Looking up product...</Text>
            </View>
          )}
          {stage === 'found' && (
            <View className="w-full px-5 py-4 gap-3">
              <View className="flex-row items-center gap-3">
                <View className="w-14 h-14 rounded-xl bg-teal-50 items-center justify-center">
                  <Ionicons name="cube-outline" size={28} color="#1D9E75" />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-medium text-text-primary">{MOCK_PRODUCT.name}</Text>
                  <Text className="text-[12px] text-text-muted mt-0.5">{MOCK_PRODUCT.brand} · {MOCK_PRODUCT.size}</Text>
                </View>
                <View className="bg-teal-50 rounded-lg px-2.5 py-1">
                  <Text className="text-[11px] font-medium text-teal-600">{MOCK_PRODUCT.category}</Text>
                </View>
              </View>
              <View className="border-t border-border pt-3">
                <Text className="text-[11px] text-text-faint">Barcode: {MOCK_PRODUCT.barcode}</Text>
              </View>
            </View>
          )}
          {stage === 'not-found' && (
            <View className="items-center gap-3 px-5">
              <Ionicons name="alert-circle-outline" size={40} color="#D6EDE5" />
              <Text className="text-[14px] text-text-muted text-center">Product not found. Try typing the item name instead.</Text>
            </View>
          )}
        </View>

        {/* Quantity (shown after found) */}
        {stage === 'found' && (
          <View className="bg-white border border-border rounded-xl px-4 py-4 gap-3">
            <Text className="text-[13px] font-medium text-text-muted uppercase tracking-wider">Quantity</Text>
            <View className="flex-row items-center gap-4">
              <TouchableOpacity
                className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center"
                onPress={() => setQty((v) => Math.max(1, v - 1))}
              >
                <Ionicons name="remove" size={20} color="#1D9E75" />
              </TouchableOpacity>
              <Text className="text-[22px] font-medium text-text-primary w-10 text-center">{qty}</Text>
              <TouchableOpacity
                className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center"
                onPress={() => setQty((v) => v + 1)}
              >
                <Ionicons name="add" size={20} color="#1D9E75" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Actions */}
        <View className="gap-3">
          {stage === 'scanning' && !loading && (
            <TouchableOpacity
              className="bg-teal-600 rounded-xl py-4 items-center flex-row justify-center gap-2"
              onPress={simulateScan}
              activeOpacity={0.85}
            >
              <Ionicons name="barcode-outline" size={20} color="#fff" />
              <Text className="text-[16px] font-semibold text-white">Simulate scan</Text>
            </TouchableOpacity>
          )}

          {stage === 'found' && (
            <>
              <TouchableOpacity
                className="bg-teal-600 rounded-xl py-4 items-center"
                onPress={handleAdd}
                activeOpacity={0.85}
              >
                <Text className="text-[16px] font-semibold text-white">Add to list</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="bg-white border border-border rounded-xl py-3.5 items-center"
                onPress={() => { setStage('scanning'); setQty(1); }}
              >
                <Text className="text-[14px] font-medium text-text-secondary">Scan another</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            className="items-center py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Text className="text-[13px] text-text-muted">Type item name instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}