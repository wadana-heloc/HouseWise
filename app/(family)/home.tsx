import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useItemStore } from '../../store/itemStore';
import { useLowStockStore } from '../../store/lowStockStore';
import { useMemberStore } from '../../store/memberStore';
import type { Item } from '../../services/items';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function FamilyHomeScreen() {
  const router = useRouter();
  const { displayName, userId } = useAuthStore();
  const name     = displayName ?? 'User';
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  const greeting = getGreeting();

  const { items, loading, fetchItems, updateStatus, deleteItem, addItem } = useItemStore();
  const { flags, loading: flagsLoading, fetchFlags } = useLowStockStore();
  const { members, fetchMembers } = useMemberStore();
  const [newItem, setNewItem]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchItems();
      fetchFlags();
      fetchMembers();
    }, []),
  );

  const preview     = items.slice(0, 4);
  const myItems     = items.filter((i) => i.added_by === userId);
  const urgentCount = items.filter((i) => i.urgent && i.status !== 'done').length;

  function toggleDone(item: Item) {
    const next = item.status === 'done' ? 'pending' : 'done';
    updateStatus(item.id, next).catch(() =>
      Alert.alert('Error', 'Could not update item. Try again.'),
    );
  }

  function confirmDelete(id: string, itemName: string, addedBy: string) {
    if (addedBy !== userId) {
      Alert.alert('Not allowed', 'You can only remove items you added yourself.');
      return;
    }
    Alert.alert('Remove item', `Remove "${itemName}" from the list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => deleteItem(id).catch(() =>
          Alert.alert('Error', 'Could not remove item. Try again.'),
        ),
      },
    ]);
  }

  async function handleQuickAdd() {
    if (!newItem.trim()) return;
    setSubmitting(true);
    try {
      await addItem({ name: newItem.trim(), category: 'other', quantity: 1, unit: 'units', urgent: false });
      setNewItem('');
    } catch {
      Alert.alert('Error', 'Could not add item. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* ── Top bar ── */}
      <View className="flex-row items-center justify-between px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center gap-2.5">
          <View className="w-9 h-9 rounded-xl bg-teal-600 items-center justify-center">
            <Ionicons name="home" size={18} color="#fff" />
          </View>
          <Text className="text-[17px] font-medium text-text-primary">HouseWise</Text>
        </View>
        <View className="flex-row items-center gap-2.5">
          <TouchableOpacity onPress={() => Alert.alert('Notifications', 'No new notifications.')}>
            <Ionicons name="notifications-outline" size={22} color="#7AAA96" />
          </TouchableOpacity>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-teal-50 items-center justify-center"
            onPress={() => router.push('/(family)/profile')}
          >
            <Text className="text-[13px] font-medium text-teal-600">{initials}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>

        {/* ── Greeting card ── */}
        <View className="mx-5 mt-4 bg-white border border-border rounded-2xl p-4 flex-row items-center justify-between">
          <View>
            <Text className="text-[20px] font-medium text-text-primary">
              {greeting}, {name} 👋
            </Text>
            <Text className="text-[13px] text-text-muted mt-1">
              {loading
                ? 'Loading list…'
                : `${items.length} items on the list${urgentCount > 0 ? ` · ${urgentCount} urgent` : ''}`
              }
            </Text>
          </View>
          <View className="bg-teal-50 rounded-xl px-3 py-2 items-center">
            <Text className="text-[11px] text-text-muted">Role</Text>
            <Text className="text-[13px] font-medium text-teal-600">Family</Text>
          </View>
        </View>

        {/* ── Quick actions ── */}
        <View className="px-5 mt-5">
          <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">
            Quick actions
          </Text>
          <View className="flex-row flex-wrap gap-2.5">
            <QuickAction
              icon="add-circle-outline"
              label="Add item"
              sub="To shopping list"
              onPress={() => router.push('/(family)/add-item')}
            />
            <QuickAction
              icon="barcode-outline"
              label="Scan barcode"
              sub="Identify product"
              onPress={() => router.push('/barcode-confirm')}
            />
            <QuickAction
              icon="camera-outline"
              label="Scan photo"
              sub="Photograph product"
              onPress={() => router.push('/image-scan')}
            />
            <LockedAction label="Weekly report" sub="Admin only" />
            <LockedAction label="Settings"      sub="Admin only" />
          </View>
        </View>

        {/* ── Shopping list ── */}
        <View className="px-5 mt-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase">
              Shopping list
            </Text>
            <TouchableOpacity onPress={() => router.push('/(family)/list')}>
              <Text className="text-[13px] font-medium text-teal-600">See all ({items.length})</Text>
            </TouchableOpacity>
          </View>

          {/* Quick add */}
          <View className="flex-row gap-2.5 mb-3">
            <TextInput
              className="flex-1 bg-white border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
              placeholder="Quick add an item…"
              placeholderTextColor="#A8C4B8"
              value={newItem}
              onChangeText={setNewItem}
              onSubmitEditing={handleQuickAdd}
              returnKeyType="done"
              editable={!submitting}
            />
            <TouchableOpacity
              className={`rounded-xl px-4 items-center justify-center ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
              onPress={handleQuickAdd}
              activeOpacity={0.85}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add" size={22} color="#fff" />
              }
            </TouchableOpacity>
          </View>

          {loading && (
            <View className="bg-white border border-border rounded-xl py-8 items-center gap-2">
              <ActivityIndicator size="small" color="#1D9E75" />
              <Text className="text-[13px] text-text-muted">Loading items…</Text>
            </View>
          )}

          {!loading && items.length === 0 && (
            <View className="bg-white border border-border rounded-xl py-8 items-center gap-2">
              <Ionicons name="basket-outline" size={28} color="#D6EDE5" />
              <Text className="text-[13px] text-text-muted">No items yet</Text>
            </View>
          )}

          {!loading && preview.map((item) => {
            const isDone = item.status === 'done';
            const isOwn  = item.added_by === userId;

            return (
              <View
                key={item.id}
                className="bg-white border border-border rounded-xl px-4 py-3 flex-row items-center gap-3 mb-2"
              >
                <TouchableOpacity
                  className={`w-6 h-6 rounded-md border-2 items-center justify-center ${isDone ? 'bg-teal-600 border-teal-600' : 'border-border'}`}
                  onPress={() => toggleDone(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {isDone && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>

                <View className="flex-1">
                  <Text className={`text-[14px] font-medium ${isDone ? 'line-through text-text-faint' : 'text-text-primary'}`}>
                    {item.name}
                  </Text>
                  <Text className="text-[12px] text-text-faint mt-0.5">
                    {isOwn ? 'You' : (members.find((m) => m.id === item.added_by)?.display_name ?? 'Member')} · {item.quantity} {item.unit}
                  </Text>
                </View>

                <View className="flex-row items-center gap-2">
                  {item.urgent && !isDone && (
                    <View className="w-2 h-2 rounded-full bg-amber-400" />
                  )}
                  <TouchableOpacity
                    onPress={() => confirmDelete(item.id, item.name, item.added_by)}
                    className={`w-6 h-6 rounded-full bg-bg-primary items-center justify-center ${!isOwn ? 'opacity-25' : ''}`}
                    activeOpacity={isOwn ? 0.7 : 1}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={14} color="#A8C4B8" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {!loading && urgentCount > 0 && (
            <View className="flex-row items-center gap-1.5 py-1">
              <View className="w-2 h-2 rounded-full bg-amber-400" />
              <Text className="text-[12px] text-amber-700">
                {urgentCount} urgent {urgentCount === 1 ? 'item needs' : 'items need'} attention
              </Text>
            </View>
          )}
        </View>

        {/* ── Low stock ── */}
        <View className="px-5 mt-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase">
              Low stock {flags.length > 0 ? `(${flags.length})` : ''}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(family)/low-stock')}>
              <Text className="text-[13px] font-medium text-teal-600">Flag item</Text>
            </TouchableOpacity>
          </View>
          <View className="bg-white border border-border rounded-xl px-4">
            {flagsLoading && (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#1D9E75" />
              </View>
            )}
            {!flagsLoading && flags.length === 0 && (
              <View className="py-4 items-center">
                <Text className="text-[13px] text-text-faint">All stocked up!</Text>
              </View>
            )}
            {!flagsLoading && flags.slice(0, 3).map((flag, i) => {
              const preview = flags.slice(0, 3);
              return (
                <View
                  key={flag.id}
                  className={`flex-row items-center gap-3 py-3 ${i < preview.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <View className="w-2 h-2 rounded-full bg-amber-400" />
                  <Text className="flex-1 text-[14px] text-text-primary" numberOfLines={1}>{flag.name}</Text>
                  <Text className="text-[12px] text-text-faint">
                    {flag.added_by === userId ? 'Flagged by you' : `Flagged by ${flag.added_by_display_name}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── My items ── */}
        <View className="px-5 mt-6">
          <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">
            My items ({myItems.length})
          </Text>
          <View className="bg-white border border-border rounded-xl px-4">
            {loading ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#1D9E75" />
              </View>
            ) : myItems.length === 0 ? (
              <View className="py-4 items-center">
                <Text className="text-[13px] text-text-faint">You haven't added any items yet.</Text>
              </View>
            ) : (
              myItems.map((item, i) => (
                <View
                  key={item.id}
                  className={`flex-row items-center gap-3 py-3 ${i < myItems.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <View className={`w-2 h-2 rounded-full ${item.status === 'done' ? 'bg-teal-400' : 'bg-border'}`} />
                  <Text className={`flex-1 text-[14px] ${item.status === 'done' ? 'line-through text-text-faint' : 'text-text-primary'}`}>
                    {item.name}
                  </Text>
                  <Text className="text-[12px] text-text-faint">{item.quantity} {item.unit}</Text>
                </View>
              ))
            )}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({
  icon, label, sub, onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="bg-white border border-border rounded-xl p-3.5 flex-col gap-2"
      style={{ width: '47.5%' }}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View className="w-9 h-9 rounded-xl bg-teal-50 items-center justify-center">
        <Ionicons name={icon} size={20} color="#1D9E75" />
      </View>
      <Text className="text-[13px] font-medium text-text-primary">{label}</Text>
      <Text className="text-[12px] text-text-faint -mt-1.5">{sub}</Text>
    </TouchableOpacity>
  );
}

function LockedAction({ label, sub }: { label: string; sub: string }) {
  return (
    <View
      className="bg-bg-primary border border-border rounded-xl p-3.5 flex-col gap-2 opacity-50"
      style={{ width: '47.5%' }}
    >
      <View className="w-9 h-9 rounded-xl bg-border items-center justify-center">
        <Ionicons name="lock-closed-outline" size={18} color="#A8C4B8" />
      </View>
      <Text className="text-[13px] font-medium text-text-muted">{label}</Text>
      <Text className="text-[12px] text-text-faint -mt-1.5">{sub}</Text>
    </View>
  );
}
