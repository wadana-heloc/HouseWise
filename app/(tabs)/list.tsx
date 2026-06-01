import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StatusBar, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { useItemStore } from '../../store/itemStore';
import { useAuthStore } from '../../store/authStore';
import { useMemberStore } from '../../store/memberStore';
import type { Item } from '../../services/items';

const FILTERS = ['All', 'Urgent', 'Done'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const time = format(d, 'h:mm a');
  if (isToday(d)) return `Today, ${time}`;
  if (isYesterday(d)) return `Yesterday, ${time}`;
  return format(d, 'MMM d') + `, ${time}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function ListScreen() {
  const router = useRouter();
  const { items, loading, error, fetchItems, deleteItem, updateStatus } = useItemStore();
  const { role, userId } = useAuthStore();
  const isAdmin = role === 'admin';
  const { members, fetchMembers } = useMemberStore();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  useFocusEffect(
    useCallback(() => {
      fetchItems();
      fetchMembers();
    }, []),
  );

  const filtered = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
    if (filter === 'Urgent') return matchSearch && item.urgent && item.status !== 'done';
    if (filter === 'Done')   return matchSearch && item.status === 'done';
    return matchSearch;
  });

  const doneCount   = items.filter((i) => i.status === 'done').length;
  const urgentCount = items.filter((i) => i.urgent && i.status !== 'done').length;

  function canDelete(addedBy: string): boolean {
    return isAdmin || addedBy === userId;
  }

  function toggleDone(item: Item) {
    const next = item.status === 'done' ? 'pending' : 'done';
    updateStatus(item.id, next).catch(() =>
      Alert.alert('Error', 'Could not update item status. Try again.'),
    );
  }

  function confirmDelete(id: string, name: string) {
    Alert.alert(
      'Remove item',
      `Remove "${name}" from the list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            deleteItem(id).catch(() =>
              Alert.alert('Error', 'Could not remove item. Try again.'),
            ),
        },
      ],
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-border">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-[22px] font-medium text-text-primary">Shopping list</Text>
          <TouchableOpacity
            className="flex-row items-center gap-1 bg-teal-600 rounded-xl px-3 py-2"
            onPress={() => router.push('/(tabs)/add-item')}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text className="text-[13px] font-medium text-white">Add item</Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View className="flex-row items-center gap-2 mb-3">
          <View className="flex-1 h-1.5 bg-teal-50 rounded-full">
            <View
              className="h-1.5 bg-teal-600 rounded-full"
              style={{ width: `${items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0}%` }}
            />
          </View>
          <Text className="text-[12px] text-text-muted">{doneCount}/{items.length} done</Text>
          {urgentCount > 0 && (
            <View className="bg-amber-100 rounded-full px-2 py-0.5">
              <Text className="text-[11px] font-medium text-amber-800">{urgentCount} urgent</Text>
            </View>
          )}
        </View>

        {/* Search */}
        <View className="flex-row items-center gap-2 bg-bg-primary border border-border rounded-xl px-3 py-2.5">
          <Ionicons name="search-outline" size={16} color="#A8C4B8" />
          <TextInput
            className="flex-1 text-[14px] text-text-primary"
            placeholder="Search items..."
            placeholderTextColor="#A8C4B8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#A8C4B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <View style={{ height: 50, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#D6EDE5' }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center', height: 50 }}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            className={`px-4 py-1.5 rounded-full ${filter === f ? 'bg-teal-600' : 'bg-white'}`}
            style={{ borderWidth: 1, borderColor: filter === f ? '#0d9488' : '#D6EDE5' }}
            onPress={() => setFilter(f)}
          >
            <Text className={`text-[13px] font-medium ${filter === f ? 'text-white' : 'text-text-muted'}`}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>

      {/* Body */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 8 }}
      >
        {loading && (
          <View className="items-center py-16 gap-3">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[14px] text-text-muted">Loading items…</Text>
          </View>
        )}

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

        {!loading && !error && items.length === 0 && (
          <View className="items-center py-16 gap-3">
            <View className="w-16 h-16 rounded-full bg-teal-50 items-center justify-center">
              <Ionicons name="basket-outline" size={32} color="#1D9E75" />
            </View>
            <Text className="text-[16px] font-medium text-text-primary">Your list is empty</Text>
            <Text className="text-[13px] text-text-muted text-center px-8">
              Tap "Add item" to start building your household shopping list.
            </Text>
          </View>
        )}

        {!loading && !error && items.length > 0 && filtered.length === 0 && (
          <View className="items-center py-16 gap-2">
            <Ionicons name="search-outline" size={40} color="#D6EDE5" />
            <Text className="text-[15px] text-text-muted mt-1">No items match your filter</Text>
          </View>
        )}

        {!loading && !error && filtered.map((item) => {
          const isDone      = item.status === 'done';
          const isRejected  = item.status === 'rejected';
          const isInReview  = item.status === 'in_review';
          const isApproved  = item.status === 'approved';
          const isOwn       = item.added_by === userId;
          const deletable   = canDelete(item.added_by);

          return (
            <View
              key={item.id}
              className="bg-white border border-border rounded-xl px-4 py-3 flex-row items-center gap-3"
            >
              {/* Checkbox — any member can mark done / undo done */}
              <TouchableOpacity
                className={`w-6 h-6 rounded-md border-2 items-center justify-center ${
                  isDone ? 'bg-teal-600 border-teal-600' : 'border-border'
                }`}
                onPress={() => toggleDone(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isDone && <Ionicons name="checkmark" size={14} color="#fff" />}
              </TouchableOpacity>

              {/* Info */}
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  <Text
                    className={`text-[14px] font-medium ${
                      isDone ? 'line-through text-text-faint' : 'text-text-primary'
                    }`}
                  >
                    {item.name}
                  </Text>
                  {item.urgent && !isDone && (
                    <View className="bg-amber-100 rounded px-1.5 py-0.5">
                      <Text className="text-[10px] font-medium text-amber-800">Urgent</Text>
                    </View>
                  )}
                  {isOwn && (
                    <View className="bg-teal-50 rounded px-1.5 py-0.5">
                      <Text className="text-[10px] font-medium text-teal-600">Mine</Text>
                    </View>
                  )}
                  {isInReview && (
                    <View className="bg-blue-50 rounded px-1.5 py-0.5">
                      <Text className="text-[10px] font-medium text-blue-600">In review</Text>
                    </View>
                  )}
                  {isApproved && (
                    <View className="bg-emerald-50 rounded px-1.5 py-0.5">
                      <Text className="text-[10px] font-medium text-emerald-700">Approved</Text>
                    </View>
                  )}
                  {isRejected && (
                    <View className="bg-red-50 rounded px-1.5 py-0.5">
                      <Text className="text-[10px] font-medium text-red-600">Rejected</Text>
                    </View>
                  )}
                </View>

                <Text className="text-[12px] text-text-faint mt-0.5">
                  {isOwn ? 'You' : (members.find((m) => m.id === item.added_by)?.display_name ?? 'Member')} · {item.quantity} {item.unit} · {capitalize(item.category)}
                </Text>
                <Text className="text-[11px] text-text-faint mt-0.5">
                  {formatDate(item.created_at)}
                </Text>
              </View>

              {/* Delete button */}
              <TouchableOpacity
                onPress={() =>
                  deletable
                    ? confirmDelete(item.id, item.name)
                    : Alert.alert('Not allowed', 'Only the person who added this item or an admin can remove it.')
                }
                className={`w-6 h-6 rounded-full bg-bg-primary items-center justify-center ${!deletable ? 'opacity-25' : ''}`}
                activeOpacity={deletable ? 0.7 : 1}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={14} color="#A8C4B8" />
              </TouchableOpacity>
            </View>
          );
        })}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
