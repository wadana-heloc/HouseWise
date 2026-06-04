import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StatusBar, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useItemStore } from '../../store/itemStore';
import { useLowStockStore } from '../../store/lowStockStore';

const CATEGORIES = ['Dairy', 'Meat', 'Grains', 'Bakery', 'Pantry', 'Produce', 'Frozen', 'Drinks', 'Cleaning', 'Other'];
const UNITS = ['units', 'kg', 'g', 'L', 'ml', 'packs', 'loaves', 'bottles', 'cans', 'bags'];
const MAX_QTY = 9999;

export default function FamilyAddItemScreen() {
  const router = useRouter();
  const { prefillName = '', lowStockFlagId = '' } = useLocalSearchParams<{ prefillName?: string; lowStockFlagId?: string }>();
  const addItem = useItemStore((s) => s.addItem);
  const markOnList = useLowStockStore((s) => s.markOnList);

  const [name, setName] = useState(prefillName);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('units');
  const [category, setCategory] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [qtyError, setQtyError] = useState('');

  function resetForm() {
    setName(''); setQty('1'); setUnit('units');
    setUrgent(false); setNotes(''); setCategory(''); setQtyError('');
  }

  async function handleAdd() {
    if (!name.trim()) {
      Alert.alert('Item name required', 'Please enter the item name before adding.');
      return;
    }
    const parsed = parseFloat(qty);
    if (isNaN(parsed) || parsed <= 0) {
      setQtyError('Please enter a valid quantity.');
      return;
    }
    if (parsed > MAX_QTY) {
      setQtyError(`Quantity can't exceed ${MAX_QTY}. Please enter a smaller number.`);
      return;
    }
    const quantity = Math.max(0.5, parsed);
    setSubmitting(true);
    try {
      await addItem({
        name: name.trim(),
        category: category ? category.toLowerCase() : 'other',
        quantity,
        unit,
        urgent,
        notes: notes.trim() || undefined,
      });

      if (lowStockFlagId) {
        markOnList(lowStockFlagId);
        Alert.alert('Added to list', `"${name.trim()}" has been added to the shopping list.`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Item added', `"${name.trim()}" has been added to the list.`, [
          { text: 'Add another', onPress: resetForm },
          { text: 'Go to list', onPress: () => router.push('/(family)/list') },
        ]);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : 'Failed to add item. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center justify-between">
        {lowStockFlagId ? (
          <View className="flex-row items-center gap-3">
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color="#3D6B55" />
            </TouchableOpacity>
            <Text className="text-[22px] font-medium text-text-primary">Add to list</Text>
          </View>
        ) : (
          <Text className="text-[22px] font-medium text-text-primary">Add item</Text>
        )}
        <TouchableOpacity
          className="flex-row items-center gap-1.5"
          onPress={() => router.push('/barcode-confirm')}
        >
          <Ionicons name="barcode-outline" size={20} color="#1D9E75" />
          <Text className="text-[13px] font-medium text-teal-600">Scan barcode</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        {/* Item name */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Item name</Text>
          <TextInput
            className="bg-white border border-border rounded-xl px-4 py-3.5 text-[15px] text-text-primary"
            placeholder="e.g. Whole milk 2L"
            placeholderTextColor="#A8C4B8"
            value={name}
            onChangeText={setName}
            autoFocus={!prefillName}
          />
        </View>

        {/* Qty + Unit */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Quantity & unit</Text>
          <View className="flex-row gap-3">
            <View className={`flex-row items-center bg-white border rounded-xl overflow-hidden ${qtyError ? 'border-red-400' : 'border-border'}`} style={{ width: 120 }}>
              <TouchableOpacity
                className="px-3 py-3.5 items-center justify-center"
                onPress={() => { setQtyError(''); setQty((v) => String(Math.max(0.5, Math.round((Number(v) - 0.5) * 10) / 10))); }}
              >
                <Ionicons name="remove" size={18} color="#7AAA96" />
              </TouchableOpacity>
              <TextInput
                className="flex-1 text-center text-[16px] font-medium text-text-primary"
                value={qty}
                onChangeText={(v) => { setQtyError(''); setQty(v); }}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity
                className="px-3 py-3.5 items-center justify-center"
                onPress={() => { setQtyError(''); setQty((v) => String(Math.round((Number(v) + 0.5) * 10) / 10)); }}
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
          {qtyError ? (
            <Text className="text-[12px] text-red-500 mt-1">{qtyError}</Text>
          ) : null}
        </View>

        {/* Category */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">
            Category <Text className="text-text-faint normal-case">(defaults to Other)</Text>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                className={`px-3 py-2 rounded-xl border ${category === c ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                onPress={() => setCategory(c)}
              >
                <Text className={`text-[13px] font-medium ${category === c ? 'text-white' : 'text-text-muted'}`}>{c}</Text>
              </TouchableOpacity>
            ))}
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

        {/* Submit */}
        <TouchableOpacity
          className={`rounded-xl py-4 flex-row items-center justify-center gap-2 mt-2 ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
          onPress={handleAdd}
          activeOpacity={0.85}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="add-circle-outline" size={20} color="#fff" />
          }
          <Text className="text-[16px] font-semibold text-white">
            {submitting ? 'Adding…' : 'Add to list'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
