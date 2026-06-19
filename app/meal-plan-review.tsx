import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMealPlanStore } from '../store/mealPlanStore';
import type { MealPlanDay } from '../services/mealPlan';
import { addItem } from '../services/items';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const PREP_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  prep:   { bg: '#FEF3C7', text: '#92400E', label: 'Prep' },
  reheat: { bg: '#DBEAFE', text: '#1E40AF', label: 'Reheat' },
  fresh:  { bg: '#DCFCE7', text: '#166534', label: 'Fresh' },
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  dairy:     { bg: '#DBEAFE', text: '#1E40AF' },
  meat:      { bg: '#FFE4E6', text: '#9F1239' },
  protein:   { bg: '#FFE4E6', text: '#9F1239' },
  vegetable: { bg: '#DCFCE7', text: '#166534' },
  fruit:     { bg: '#FEF3C7', text: '#92400E' },
  grain:     { bg: '#FEF9C3', text: '#854D0E' },
  spice:     { bg: '#F3E8FF', text: '#6B21A8' },
  herb:      { bg: '#ECFDF5', text: '#065F46' },
  other:     { bg: '#F3F4F6', text: '#374151' },
};

function getCategoryStyle(category: string) {
  return CATEGORY_COLORS[category.toLowerCase()] ?? CATEGORY_COLORS.other;
}

function getThisWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function MealPlanReviewScreen() {
  const router = useRouter();
  const { week_start } = useLocalSearchParams<{ week_start: string }>();
  const weekStart = week_start ?? getThisWeekStart();
  const {
    currentPlan, loading, finalizing,
    fetchPlan, updatePlanDay, finalizePlan,
  } = useMealPlanStore();

  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [editingDay, setEditingDay] = useState<MealPlanDay | null>(null);
  const [selectedDay, setSelectedDay] = useState<MealPlanDay | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrepLabel, setEditPrepLabel] = useState<'prep' | 'reheat' | 'fresh'>('fresh');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  interface ShoppingItem { key: string; name: string; quantity: string; unit: string; category: string; checked: boolean; }
  const [shoppingModal, setShoppingModal] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [addingToList, setAddingToList] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!currentPlan) fetchPlan(weekStart);
  }, []));

  function openEditor(day: MealPlanDay) {
    setEditingDay(day);
    setEditName(day.meal_name);
    setEditPrepLabel(day.prep_label);
    setEditNotes(day.notes ?? '');
  }

  async function handleSaveDay() {
    if (!editingDay || !currentPlan) return;
    setSaving(true);
    try {
      await updatePlanDay(currentPlan.id, editingDay, {
        meal_name: editName.trim() || editingDay.meal_name,
        prep_label: editPrepLabel,
        notes: editNotes.trim() || null,
      });
      setEditingDay(null);
    } catch {
      Alert.alert('Error', 'Could not save changes. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!currentPlan) return;
    Alert.alert(
      'Finalize plan',
      "This will publish the plan to all family members. You'll review the shopping list next.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize', onPress: async () => {
            try {
              await finalizePlan(currentPlan.id);
              const seen = new Set<string>();
              const items: ShoppingItem[] = [];
              for (const day of currentPlan.days) {
                for (const ing of day.suggested_ingredients ?? []) {
                  const key = ing.name.toLowerCase().trim();
                  if (!seen.has(key)) {
                    seen.add(key);
                    items.push({ key, name: ing.name, quantity: ing.quantity, unit: ing.unit, category: ing.category, checked: true });
                  }
                }
              }
              setShoppingItems(items);
              setShoppingModal(true);
            } catch {
              Alert.alert('Error', 'Could not finalize plan. Try again.');
            }
          },
        },
      ],
    );
  }

  async function addToShoppingList() {
    const checked = shoppingItems.filter(i => i.checked);
    if (!checked.length) { setShoppingModal(false); return; }
    setAddingToList(true);
    try {
      await Promise.all(checked.map(item =>
        addItem({
          name: item.name,
          category: item.category,
          quantity: parseFloat(item.quantity) || 1,
          unit: item.unit || 'units',
          urgent: false,
        })
      ));
      setShoppingModal(false);
      Alert.alert('Done', `${checked.length} item${checked.length > 1 ? 's' : ''} added to shopping list.`);
    } catch {
      Alert.alert('Error', 'Some items could not be added. Try again.');
    } finally {
      setAddingToList(false);
    }
  }

  const sortedDays = currentPlan
    ? [...currentPlan.days].sort((a, b) => a.day_of_week - b.day_of_week)
    : [];

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Review Plan</Text>
        </View>
        {currentPlan && (
          <View className={`px-2.5 py-1 rounded-full ${currentPlan.status === 'finalized' ? 'bg-teal-50' : 'bg-amber-50'}`}>
            <Text className={`text-[11px] font-semibold capitalize ${currentPlan.status === 'finalized' ? 'text-teal-700' : 'text-amber-700'}`}>
              {currentPlan.status}
            </Text>
          </View>
        )}
      </View>

      {loading && !currentPlan ? (
        <View className="flex-1 items-center justify-center gap-2">
          <ActivityIndicator size="large" color="#1D9E75" />
          <Text className="text-[13px] text-text-muted">Loading plan…</Text>
        </View>
      ) : !currentPlan ? (
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <Ionicons name="calendar-outline" size={48} color="#D6EDE5" />
          <Text className="text-[15px] font-medium text-text-muted text-center">No plan generated yet</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-[13px] font-medium text-teal-600">Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 120 }}
          >
            {/* AI summary */}
            {currentPlan.ai_summary && (
              <View className="bg-teal-600 rounded-2xl overflow-hidden">
                <TouchableOpacity
                  className="flex-row items-center justify-between px-4 py-3.5"
                  onPress={() => setSummaryExpanded(v => !v)}
                  activeOpacity={0.8}
                >
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="sparkles-outline" size={16} color="#fff" />
                    <Text className="text-[14px] font-semibold text-white">AI Summary</Text>
                  </View>
                  <Ionicons
                    name={summaryExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#fff"
                  />
                </TouchableOpacity>
                {summaryExpanded && (
                  <View className="px-4 pb-4">
                    <Text className="text-[13px] text-teal-50 leading-5">{currentPlan.ai_summary}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Day cards */}
            {sortedDays.map(day => {
              const ps = PREP_STYLES[day.prep_label];
              return (
                <TouchableOpacity
                  key={day.id}
                  className="bg-white border border-border rounded-2xl px-4 py-4 gap-2"
                  onPress={() => currentPlan.status === 'finalized' ? setSelectedDay(day) : openEditor(day)}
                  activeOpacity={0.8}
                >
                  <View className="flex-row items-center gap-3">
                    <Text className="text-[13px] font-semibold text-text-muted w-8">
                      {DAY_NAMES[day.day_of_week]}
                    </Text>
                    <View
                      className="px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: ps.bg }}
                    >
                      <Text className="text-[11px] font-semibold" style={{ color: ps.text }}>
                        {ps.label}
                      </Text>
                    </View>
                    <Text className="flex-1 text-[15px] font-medium text-text-primary" numberOfLines={1}>
                      {day.meal_name}
                    </Text>
                    <Ionicons
                      name={currentPlan.status === 'finalized' ? 'chevron-forward' : 'pencil-outline'}
                      size={16}
                      color="#A8C4B8"
                    />
                  </View>
                  {day.notes && (
                    <Text className="text-[12px] text-text-faint ml-11" numberOfLines={2}>
                      {day.notes}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}

          </ScrollView>

          {/* Sticky bottom bar */}
          <View className="absolute bottom-0 left-0 right-0 px-5 pb-8 pt-4 bg-bg-primary border-t border-border">
            {currentPlan?.status !== 'finalized' && (
              <TouchableOpacity
                className={`rounded-2xl py-4 flex-row items-center justify-center gap-2 ${finalizing ? 'bg-teal-400' : 'bg-teal-600'}`}
                onPress={handleFinalize}
                activeOpacity={0.85}
                disabled={finalizing}
              >
                {finalizing ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text className="text-[16px] font-semibold text-white">Finalizing…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text className="text-[16px] font-semibold text-white">Finalize plan</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            {currentPlan?.status === 'finalized' && (
              <View className="bg-teal-50 border border-teal-100 rounded-2xl py-3.5 items-center">
                <Text className="text-[14px] font-semibold text-teal-700">Plan published ✓</Text>
              </View>
            )}
          </View>
        </>
      )}

      {/* Day detail modal (finalized) */}
      <Modal
        visible={selectedDay !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDay(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <SafeAreaView className="bg-white rounded-t-3xl" style={{ maxHeight: '85%' }}>
            {selectedDay && (() => {
              const ps = PREP_STYLES[selectedDay.prep_label];
              return (
                <>
                  <View className="items-center pt-3 pb-1">
                    <View className="w-10 h-1 rounded-full bg-gray-200" />
                  </View>
                  <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-border">
                    <Text className="text-[18px] font-bold text-text-primary">
                      {DAY_FULL[selectedDay.day_of_week]}
                    </Text>
                    <TouchableOpacity onPress={() => setSelectedDay(null)} hitSlop={8}>
                      <Ionicons name="close" size={22} color="#3D6B55" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 32 }}
                  >
                    {/* Meal info */}
                    <View className="flex-row items-start gap-3">
                      <View className="w-11 h-11 rounded-xl bg-teal-50 items-center justify-center">
                        <Ionicons name="restaurant-outline" size={22} color="#1D9E75" />
                      </View>
                      <View className="flex-1 gap-2">
                        <Text className="text-[20px] font-bold text-text-primary leading-7">
                          {selectedDay.meal_name}
                        </Text>
                        <View className="px-3 py-1.5 rounded-full self-start" style={{ backgroundColor: ps.bg }}>
                          <Text className="text-[12px] font-semibold" style={{ color: ps.text }}>{ps.label}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Notes */}
                    {selectedDay.notes && (
                      <View className="flex-row gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                        <Ionicons name="document-text-outline" size={16} color="#D97706" style={{ marginTop: 1 }} />
                        <Text className="flex-1 text-[13px] text-amber-800 leading-5">{selectedDay.notes}</Text>
                      </View>
                    )}

                    {/* Ingredients */}
                    {(selectedDay.suggested_ingredients ?? []).length > 0 && (
                      <View className="gap-3">
                        <View className="flex-row items-center gap-2">
                          <Ionicons name="basket-outline" size={16} color="#374151" />
                          <Text className="text-[14px] font-semibold text-text-primary">Ingredients</Text>
                          <View className="flex-1 h-px bg-border" />
                          <Text className="text-[12px] text-text-faint">
                            {(selectedDay.suggested_ingredients ?? []).length} items
                          </Text>
                        </View>
                        <View className="gap-2">
                          {(selectedDay.suggested_ingredients ?? []).map((ing, i) => {
                            const cat = getCategoryStyle(ing.category);
                            return (
                              <View
                                key={i}
                                className="flex-row items-center gap-3 bg-bg-primary rounded-xl px-3.5 py-3"
                              >
                                <View className="flex-1">
                                  <Text className="text-[14px] font-medium text-text-primary capitalize">
                                    {ing.name}
                                  </Text>
                                </View>
                                {(ing.quantity || ing.unit) && (
                                  <Text className="text-[13px] text-text-muted">
                                    {ing.quantity}{ing.unit ? ` ${ing.unit}` : ''}
                                  </Text>
                                )}
                                <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: cat.bg }}>
                                  <Text className="text-[10px] font-semibold capitalize" style={{ color: cat.text }}>
                                    {ing.category}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </SafeAreaView>
        </View>
      </Modal>

      {/* Day editor modal */}
      <Modal
        visible={editingDay !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingDay(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <SafeAreaView className="bg-white rounded-t-3xl">
            <View className="px-5 pt-4 pb-2 flex-row items-center justify-between border-b border-border">
              <Text className="text-[17px] font-semibold text-text-primary">
                {editingDay ? DAY_FULL[editingDay.day_of_week] : ''}
              </Text>
              <TouchableOpacity onPress={() => setEditingDay(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#3D6B55" />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 16 }}
            >
              {/* Meal name */}
              <View className="gap-2">
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Meal name</Text>
                <TextInput
                  className="bg-bg-primary border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="e.g. Grilled Salmon"
                  placeholderTextColor="#A8C4B8"
                />
              </View>

              {/* Prep label */}
              <View className="gap-2">
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Prep label</Text>
                <View className="flex-row gap-2">
                  {(['prep', 'reheat', 'fresh'] as const).map(label => {
                    const ps = PREP_STYLES[label];
                    const selected = editPrepLabel === label;
                    return (
                      <TouchableOpacity
                        key={label}
                        className={`flex-1 py-2.5 rounded-xl border items-center ${selected ? 'border-teal-600' : 'border-border'}`}
                        style={selected ? { backgroundColor: ps.bg } : { backgroundColor: '#fff' }}
                        onPress={() => setEditPrepLabel(label)}
                        activeOpacity={0.8}
                      >
                        <Text
                          className="text-[13px] font-semibold"
                          style={{ color: selected ? ps.text : '#A8C4B8' }}
                        >
                          {ps.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Notes */}
              <View className="gap-2">
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Notes (optional)</Text>
                <TextInput
                  className="bg-bg-primary border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="e.g. Use leftover sauce from Monday"
                  placeholderTextColor="#A8C4B8"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <TouchableOpacity
                className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${saving ? 'bg-teal-400' : 'bg-teal-600'}`}
                onPress={handleSaveDay}
                activeOpacity={0.85}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="checkmark-outline" size={20} color="#fff" />
                }
                <Text className="text-[15px] font-semibold text-white">
                  {saving ? 'Saving…' : 'Save changes'}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 8 }} />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Shopping list preview modal */}
      <Modal
        visible={shoppingModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShoppingModal(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <SafeAreaView className="bg-white rounded-t-3xl" style={{ maxHeight: '85%' }}>
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-gray-200" />
            </View>
            <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-border">
              <Text className="text-[18px] font-bold text-text-primary">Shopping list</Text>
              <TouchableOpacity onPress={() => setShoppingModal(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#3D6B55" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 20, gap: 8, paddingBottom: 24 }}
            >
              {shoppingItems.length === 0 ? (
                <View className="items-center py-8 gap-2">
                  <Ionicons name="basket-outline" size={36} color="#D6EDE5" />
                  <Text className="text-[13px] text-text-muted">No ingredients found</Text>
                </View>
              ) : (
                shoppingItems.map((item, i) => {
                  const cat = CATEGORY_COLORS[item.category.toLowerCase()] ?? CATEGORY_COLORS.other;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      className={`flex-row items-center gap-3 rounded-xl px-3.5 py-3 border ${item.checked ? 'bg-white border-border' : 'bg-bg-primary border-transparent opacity-50'}`}
                      onPress={() => setShoppingItems(prev => prev.map((s, j) => j === i ? { ...s, checked: !s.checked } : s))}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={item.checked ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={item.checked ? '#1D9E75' : '#A8C4B8'}
                      />
                      <Text className="flex-1 text-[14px] font-medium text-text-primary capitalize">{item.name}</Text>
                      {(item.quantity || item.unit) && (
                        <Text className="text-[13px] text-text-muted">
                          {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                        </Text>
                      )}
                      <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: cat.bg }}>
                        <Text className="text-[10px] font-semibold capitalize" style={{ color: cat.text }}>{item.category}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <View className="px-5 pb-6 pt-3 border-t border-border">
              <TouchableOpacity
                className={`rounded-2xl py-4 flex-row items-center justify-center gap-2 ${addingToList ? 'bg-teal-400' : 'bg-teal-600'}`}
                onPress={addToShoppingList}
                activeOpacity={0.85}
                disabled={addingToList}
              >
                {addingToList
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="basket-outline" size={20} color="#fff" />
                }
                <Text className="text-[16px] font-semibold text-white">
                  {addingToList
                    ? 'Adding…'
                    : `Add ${shoppingItems.filter(i => i.checked).length} item${shoppingItems.filter(i => i.checked).length !== 1 ? 's' : ''} to list`
                  }
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
