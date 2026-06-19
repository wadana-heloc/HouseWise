import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StatusBar,
  ScrollView, ActivityIndicator, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMealPlanStore } from '../store/mealPlanStore';
import { useAuthStore } from '../store/authStore';
import { mealPlanService } from '../services/mealPlan';
import type { MealPlanDay } from '../services/mealPlan';

const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL  = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const PREP_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  prep:   { bg: '#FEF3C7', text: '#92400E', label: 'Prep ahead' },
  reheat: { bg: '#DBEAFE', text: '#1E40AF', label: 'Reheat' },
  fresh:  { bg: '#DCFCE7', text: '#166534', label: 'Fresh cook' },
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

type Reaction = 'liked' | 'disliked';
const REACTIONS: { value: Reaction; emoji: string }[] = [
  { value: 'liked',    emoji: '👍' },
  { value: 'disliked', emoji: '👎' },
];

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

export default function MealPlanViewScreen() {
  const router = useRouter();
  const weekStart = getThisWeekStart();
  const { currentPlan, loading, fetchPlan, reactToDay } = useMealPlanStore();
  const userId = useAuthStore(s => s.userId);

  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const [reacting, setReacting] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<MealPlanDay | null>(null);

  useFocusEffect(useCallback(() => {
    fetchPlan(weekStart).then(() => {
      const plan = useMealPlanStore.getState().currentPlan;
      if (!plan || !userId) return;
      mealPlanService.getReactions(plan.id).then(({ reactions: rows }) => {
        const mine: Record<string, Reaction> = {};
        for (const r of rows) {
          if (r.user_id === userId) mine[r.day_id] = r.reaction as Reaction;
        }
        setReactions(mine);
      }).catch(() => {});
    });
  }, [userId]));

  async function handleReact(dayId: string, reaction: Reaction) {
    if (!currentPlan) return;
    setReacting(dayId);
    const prev = reactions[dayId];
    setReactions(r => ({ ...r, [dayId]: reaction }));
    try {
      await reactToDay(currentPlan.id, dayId, reaction);
    } catch {
      setReactions(r => {
        const next = { ...r };
        if (prev) next[dayId] = prev; else delete next[dayId];
        return next;
      });
      Alert.alert('Error', 'Could not save your reaction. Try again.');
    } finally {
      setReacting(null);
    }
  }

  const sortedDays = currentPlan
    ? [...currentPlan.days].sort((a, b) => a.day_of_week - b.day_of_week)
    : [];

  if (loading && !currentPlan) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center gap-2">
        <ActivityIndicator size="large" color="#1D9E75" />
        <Text className="text-[13px] text-text-muted">Loading plan…</Text>
      </SafeAreaView>
    );
  }

  if (!currentPlan) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8 gap-4">
        <Ionicons name="calendar-outline" size={48} color="#D6EDE5" />
        <Text className="text-[15px] font-medium text-text-muted text-center">No plan available yet</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-[13px] font-medium text-teal-600">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">This week's menu</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>

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
                <Text className="text-[14px] font-semibold text-white">Chef's note</Text>
              </View>
              <Ionicons name={summaryExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#fff" />
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
          const currentReaction = reactions[day.id];
          const ingredientCount = (day.suggested_ingredients ?? []).length;
          return (
            <View key={day.id} className="bg-white border border-border rounded-2xl overflow-hidden">
              <TouchableOpacity
                className="px-4 pt-4 pb-3"
                onPress={() => setSelectedDay(day)}
                activeOpacity={0.7}
              >
                <View className="flex-row items-center gap-3">
                  <View className="w-9 items-center">
                    <Text className="text-[11px] font-bold text-text-faint uppercase tracking-wide">
                      {DAY_SHORT[day.day_of_week]}
                    </Text>
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-[15px] font-semibold text-text-primary">{day.meal_name}</Text>
                    {day.notes
                      ? <Text className="text-[12px] text-text-faint" numberOfLines={1}>{day.notes}</Text>
                      : ingredientCount > 0
                        ? <Text className="text-[12px] text-text-faint">{ingredientCount} ingredients</Text>
                        : null
                    }
                  </View>
                  <View className="items-end gap-1.5">
                    <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: ps.bg }}>
                      <Text className="text-[11px] font-semibold" style={{ color: ps.text }}>{ps.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />
                  </View>
                </View>
              </TouchableOpacity>
              <View className="flex-row border-t border-border">
                {REACTIONS.map(({ value, emoji }) => {
                  const selected = currentReaction === value;
                  const isReacting = reacting === day.id;
                  return (
                    <TouchableOpacity
                      key={value}
                      className={`flex-1 py-2.5 items-center justify-center ${selected ? 'bg-teal-50' : ''} ${value !== 'disliked' ? 'border-r border-border' : ''}`}
                      onPress={() => handleReact(day.id, value)}
                      activeOpacity={0.7}
                      disabled={isReacting}
                    >
                      {isReacting && selected
                        ? <ActivityIndicator size="small" color="#1D9E75" />
                        : <Text style={{ fontSize: selected ? 20 : 18, opacity: isReacting ? 0.4 : 1 }}>{emoji}</Text>
                      }
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Day detail sheet */}
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
    </SafeAreaView>
  );
}
