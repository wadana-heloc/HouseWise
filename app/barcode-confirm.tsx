import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useItemStore } from '../store/itemStore';

const OFF_API_URL = process.env.EXPO_PUBLIC_OFF_API_URL ?? 'https://world.openfoodfacts.org/api/v3';

const UNITS = ['units', 'kg', 'g', 'L', 'ml', 'packs', 'loaves', 'bottles', 'cans', 'bags'];
const CATEGORIES = ['Dairy', 'Meat', 'Grains', 'Bakery', 'Pantry', 'Produce', 'Frozen', 'Drinks', 'Cleaning', 'Other'];

type Stage = 'scanning' | 'found' | 'not-found';

interface Product {
  name: string;
  brand: string;
  size: string;
  barcode: string;
  displayCategory: string;
  categoryKey: string;
  image: string | null;
}

function formatCategory(tags: string[] | undefined): string {
  const tag = tags?.[0];
  if (!tag) return 'Other';
  return tag
    .replace(/^[a-z]+:/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function mapCategory(tags: string[] | undefined): string {
  if (!tags?.length) return 'other';
  const keywords: [string, string][] = [
    ['dairy', 'dairy'], ['milk', 'dairy'], ['cheese', 'dairy'], ['yogurt', 'dairy'], ['butter', 'dairy'],
    ['meat', 'meat'], ['chicken', 'meat'], ['poultry', 'meat'], ['beef', 'meat'], ['seafood', 'meat'], ['fish', 'meat'], ['lamb', 'meat'],
    ['bread', 'bakery'], ['bakery', 'bakery'], ['pastry', 'bakery'],
    ['cereal', 'grains'], ['grain', 'grains'], ['rice', 'grains'], ['pasta', 'grains'], ['flour', 'grains'],
    ['beverage', 'drinks'], ['drink', 'drinks'], ['juice', 'drinks'], ['water', 'drinks'], ['soda', 'drinks'], ['coffee', 'drinks'], ['tea', 'drinks'],
    ['frozen', 'frozen'],
    ['vegetable', 'produce'], ['fruit', 'produce'],
    ['cleaning', 'cleaning'], ['household', 'cleaning'], ['detergent', 'cleaning'],
    ['snack', 'pantry'], ['sauce', 'pantry'], ['condiment', 'pantry'], ['oil', 'pantry'], ['canned', 'pantry'], ['bean', 'pantry'], ['legume', 'pantry'],
  ];
  for (const tag of tags) {
    const lower = tag.toLowerCase().replace(/^[a-z]+:/, '');
    for (const [keyword, category] of keywords) {
      if (lower.includes(keyword)) return category;
    }
  }
  return 'other';
}

function parseQuantity(raw: string): { qty: string; unit: string } {
  const match = raw.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?/);
  if (!match) return { qty: '1', unit: 'units' };
  const qty = match[1];
  const rawUnit = (match[2] || '').toLowerCase();
  const unitMap: Record<string, string> = {
    g: 'g', gr: 'g', gram: 'g', grams: 'g',
    kg: 'kg',
    l: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L',
    ml: 'ml', milliliter: 'ml', millilitre: 'ml',
    pack: 'packs', packs: 'packs',
    bottle: 'bottles', bottles: 'bottles',
    can: 'cans', cans: 'cans',
    bag: 'bags', bags: 'bags',
  };
  return { qty, unit: unitMap[rawUnit] || 'units' };
}

async function lookupBarcode(barcode: string): Promise<{ product: Product; rawTags: string[] } | null> {
  try {
    const url = `${OFF_API_URL}/product/${barcode}`;
    console.log('\n========== Barcode Scan ==========');
    console.log('Barcode:', barcode);
    console.log('Fetching:', url);

    const res = await fetch(url);
    const data = await res.json();

    if (data.result?.id !== 'product_found' || !data.product) {
      console.log('Product not found in Open Food Facts');
      console.log('API result:', data.result?.id ?? 'no result field');
      console.log('==================================\n');
      return null;
    }

    const p = data.product;
    const rawTags: string[] = p.categories_tags ?? [];
    const product: Product = {
      name: p.product_name_en || p.product_name || 'Unknown product',
      brand: p.brands?.split(',')[0]?.trim() || p.brand_owner?.split(',')[0]?.trim() || '',
      size: p.quantity || '',
      barcode,
      displayCategory: formatCategory(rawTags),
      categoryKey: mapCategory(rawTags),
      image: p.image_url || null,
    };

    console.log('Name:    ', product.name);
    console.log('Brand:   ', product.brand);
    console.log('Size:    ', product.size);
    console.log('Category:', product.displayCategory, `(→ ${product.categoryKey})`);
    console.log('==================================\n');

    return { product, rawTags };
  } catch (err) {
    console.error('Barcode lookup error:', err);
    return null;
  }
}

export default function BarcodeScanScreen() {
  const router = useRouter();
  const addItem = useItemStore((s) => s.addItem);

  const [stage, setStage] = useState<Stage>('scanning');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);

  // Form state — pre-filled from API on scan
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('units');
  const [category, setCategory] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');

  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (scannedRef.current || loading) return;
    scannedRef.current = true;
    setLoading(true);

    const result = await lookupBarcode(data);
    setLoading(false);

    if (result) {
      const { product: found } = result;
      const { qty: parsedQty, unit: parsedUnit } = parseQuantity(found.size);
      setProduct(found);
      setName(found.name);
      setQty(parsedQty);
      setUnit(parsedUnit);
      setCategory(found.categoryKey);
      setStage('found');
    } else {
      setStage('not-found');
    }
  }

  function resetScan() {
    scannedRef.current = false;
    setStage('scanning');
    setProduct(null);
    setName('');
    setQty('1');
    setUnit('units');
    setCategory('');
    setUrgent(false);
    setNotes('');
  }

  async function handleAdd() {
    if (!product || !name.trim()) return;
    const quantity = Math.max(0.5, parseFloat(qty) || 0.5);
    setSubmitting(true);
    try {
      await addItem({
        name: name.trim(),
        category: category || product.categoryKey,
        quantity,
        unit,
        urgent,
        notes: notes.trim() || undefined,
      });
      Alert.alert('Item added', `"${name.trim()}" has been added to the list.`, [
        { text: 'Scan another', onPress: resetScan },
        { text: 'Go to list', onPress: () => router.push('/(tabs)/list') },
      ]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Failed to add item. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!permission) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator size="large" color="#1D9E75" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary">
        <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />
        <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="close" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Scan barcode</Text>
        </View>
        <View className="flex-1 items-center justify-center px-8 gap-5">
          <Ionicons name="camera-outline" size={64} color="#7AAA96" />
          <Text className="text-[16px] font-medium text-text-primary text-center">Camera permission required</Text>
          <Text className="text-[13px] text-text-muted text-center">
            HouseWise needs camera access to scan barcodes.
          </Text>
          <TouchableOpacity
            className="bg-teal-600 rounded-xl py-3.5 px-8 items-center"
            onPress={requestPermission}
          >
            <Text className="text-[15px] font-semibold text-white">Grant permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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

      {/* Camera frame */}
      <View
        className="mx-5 mt-5 bg-white border border-border rounded-2xl overflow-hidden"
        style={{ height: 200 }}
      >
        {stage === 'scanning' && !loading && (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr', 'code128', 'code39'],
            }}
          >
            <View className="flex-1 items-center justify-center">
              <View className="w-48 h-28 border-2 border-teal-400 rounded-xl items-center justify-center">
                <View className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-teal-300 rounded-tl-md" />
                <View className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-teal-300 rounded-tr-md" />
                <View className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-teal-300 rounded-bl-md" />
                <View className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-teal-300 rounded-br-md" />
              </View>
              <Text style={{ color: 'white', fontSize: 12, marginTop: 12, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 }}>
                Point camera at barcode
              </Text>
            </View>
          </CameraView>
        )}

        {loading && (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Looking up product...</Text>
          </View>
        )}

        {stage === 'found' && product && (
          <View className="flex-1 px-5 py-4 justify-center gap-2">
            <View className="flex-row items-center gap-3">
              <View className="w-12 h-12 rounded-xl bg-teal-50 items-center justify-center">
                <Ionicons name="checkmark-circle" size={24} color="#1D9E75" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[14px] font-medium text-text-primary" numberOfLines={2}>
                  {product.name}
                </Text>
                <View className="flex-row items-center gap-2 mt-0.5 flex-wrap">
                  {product.brand ? <Text className="text-[11px] text-text-muted">{product.brand}</Text> : null}
                  {product.brand && product.size ? <Text className="text-[11px] text-text-faint">·</Text> : null}
                  {product.size ? <Text className="text-[11px] text-text-muted">{product.size}</Text> : null}
                  <View className="bg-teal-50 rounded-md px-2 py-0.5">
                    <Text className="text-[10px] font-medium text-teal-600">{product.displayCategory}</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity onPress={resetScan} className="p-1">
                <Ionicons name="refresh-outline" size={18} color="#7AAA96" />
              </TouchableOpacity>
            </View>
            <View className="border-t border-border pt-2">
              <Text className="text-[10px] text-text-faint">Barcode: {product.barcode}</Text>
            </View>
          </View>
        )}

        {stage === 'not-found' && (
          <View className="flex-1 items-center justify-center gap-3 px-5">
            <Ionicons name="alert-circle-outline" size={36} color="#D6EDE5" />
            <Text className="text-[13px] text-text-muted text-center">
              Product not found. Try scanning again or type the item name manually.
            </Text>
          </View>
        )}
      </View>

      {/* Form — shown after scan */}
      {stage === 'found' && product ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16 }}
        >
          {/* Name */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Item name</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[15px] text-text-primary"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#A8C4B8"
            />
          </View>

          {/* Qty + Unit */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Quantity & unit</Text>
            <View className="flex-row gap-3">
              <View className="flex-row items-center bg-white border border-border rounded-xl overflow-hidden" style={{ width: 120 }}>
                <TouchableOpacity
                  className="px-3 py-3.5 items-center justify-center"
                  onPress={() => setQty((v) => String(Math.max(0.5, Math.round((Number(v) - 0.5) * 10) / 10)))}
                >
                  <Ionicons name="remove" size={18} color="#7AAA96" />
                </TouchableOpacity>
                <TextInput
                  className="flex-1 text-center text-[16px] font-medium text-text-primary"
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  className="px-3 py-3.5 items-center justify-center"
                  onPress={() => setQty((v) => String(Math.round((Number(v) + 0.5) * 10) / 10))}
                >
                  <Ionicons name="add" size={18} color="#1D9E75" />
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, alignItems: 'center' }}
              >
                {UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    className={`px-3 py-2 rounded-xl border ${unit === u ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => setUnit(u)}
                  >
                    <Text className={`text-[13px] font-medium ${unit === u ? 'text-white' : 'text-text-muted'}`}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Category */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Category</Text>
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const key = c.toLowerCase();
                return (
                  <TouchableOpacity
                    key={c}
                    className={`px-3 py-2 rounded-xl border ${category === key ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => setCategory(key)}
                  >
                    <Text className={`text-[13px] font-medium ${category === key ? 'text-white' : 'text-text-muted'}`}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Urgent toggle */}
          <TouchableOpacity
            className={`flex-row items-center justify-between bg-white border rounded-xl px-4 py-4 ${urgent ? 'border-amber-400' : 'border-border'}`}
            onPress={() => setUrgent((v) => !v)}
            activeOpacity={0.8}
          >
            <View className="flex-row items-center gap-3">
              <View className={`w-9 h-9 rounded-xl items-center justify-center ${urgent ? 'bg-amber-100' : 'bg-teal-50'}`}>
                <Ionicons name="flash-outline" size={20} color={urgent ? '#92400E' : '#7AAA96'} />
              </View>
              <View>
                <Text className="text-[14px] font-medium text-text-primary">Mark as urgent</Text>
                <Text className="text-[12px] text-text-faint mt-0.5">Buyer will be notified immediately</Text>
              </View>
            </View>
            <View className={`w-12 h-6 rounded-full items-center justify-center ${urgent ? 'bg-amber-400' : 'bg-teal-50'}`}>
              <View className={`w-5 h-5 rounded-full bg-white ${urgent ? 'translate-x-3' : '-translate-x-1.5'}`} />
            </View>
          </TouchableOpacity>

          {/* Notes */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Notes (optional)</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
              placeholder="e.g. Low-fat version only"
              placeholderTextColor="#A8C4B8"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Actions */}
          <TouchableOpacity
            className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
            onPress={handleAdd}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="add-circle-outline" size={20} color="#fff" />}
            <Text className="text-[16px] font-semibold text-white">
              {submitting ? 'Adding…' : 'Add to list'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Text className="text-[13px] text-text-muted">Type item name instead</Text>
          </TouchableOpacity>

          <View style={{ height: 16 }} />
        </ScrollView>
      ) : (
        <View className="px-5 mt-6 gap-3">
          {stage === 'not-found' && (
            <TouchableOpacity
              className="bg-teal-600 rounded-xl py-4 items-center flex-row justify-center gap-2"
              onPress={resetScan}
              activeOpacity={0.85}
            >
              <Ionicons name="barcode-outline" size={20} color="#fff" />
              <Text className="text-[16px] font-semibold text-white">Scan again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="items-center py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Text className="text-[13px] text-text-muted">Type item name instead</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
