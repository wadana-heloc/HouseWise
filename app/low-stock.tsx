import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const INITIAL = [
  { id: '1', name: 'Laundry detergent', flaggedBy: 'Maha',  flaggedAt: '2 hours ago',  onList: true  },
  { id: '2', name: 'Dish soap',         flaggedBy: 'Ahmad', flaggedAt: '5 hours ago',  onList: true  },
  { id: '3', name: 'Toilet paper',      flaggedBy: 'Sara',  flaggedAt: 'Yesterday',    onList: false },
  { id: '4', name: 'Shampoo',           flaggedBy: 'Maha',  flaggedAt: 'Yesterday',    onList: false },
];

export default function LowStockScreen() {
  const router = useRouter();
  const [items, setItems] = useState(INITIAL);
  const [newItem, setNewItem] = useState('');

  function handleAdd() {
    if (!newItem.trim()) return;
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), name: newItem.trim(), flaggedBy: 'Ahmad', flaggedAt: 'Just now', onList: false },
    ]);
    setNewItem('');
  }

  function handleClear(id: string) {
    Alert.alert('Clear flag', 'Mark this item as restocked?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', onPress: () => setItems((prev) => prev.filter((i) => i.id !== id)) },
    ]);
  }

  function handleAddToList(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, onList: true } : i)));
    Alert.alert('Added', 'Item added to the shopping list.');
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
            Items flagged here are automatically added to the shopping list for the next purchase cycle.
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
            />
            <TouchableOpacity
              className="bg-teal-600 rounded-xl px-4 items-center justify-center"
              onPress={handleAdd}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* List */}
        <View className="gap-2">
          <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Flagged items ({items.length})</Text>
          {items.map((item) => (
            <View key={item.id} className="bg-white border border-border rounded-xl px-4 py-3 gap-2">
              <View className="flex-row items-center gap-3">
                <View className="w-2 h-2 rounded-full bg-amber-400" />
                <Text className="flex-1 text-[14px] font-medium text-text-primary">{item.name}</Text>
                <TouchableOpacity onPress={() => handleClear(item.id)}>
                  <Ionicons name="close-circle-outline" size={20} color="#D6EDE5" />
                </TouchableOpacity>
              </View>
              <View className="flex-row items-center justify-between pl-5">
                <Text className="text-[12px] text-text-faint">Flagged by {item.flaggedBy} · {item.flaggedAt}</Text>
                {item.onList ? (
                  <View className="flex-row items-center gap-1">
                    <Ionicons name="checkmark-circle" size={13} color="#1D9E75" />
                    <Text className="text-[12px] text-teal-600">On list</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => handleAddToList(item.id)}>
                    <Text className="text-[12px] font-medium text-teal-600">+ Add to list</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}