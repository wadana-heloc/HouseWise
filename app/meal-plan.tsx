import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useMealPlanStore } from '../store/mealPlanStore';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekStart(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(weekStart + 'T00:00:00');
  end.setDate(end.getDate() + 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
}

const PREP_COLORS: Record<string, { bg: string; text: string }> = {
  prep:   { bg: '#FEF3C7', text: '#92400E' },
  reheat: { bg: '#DBEAFE', text: '#1E40AF' },
  fresh:  { bg: '#DCFCE7', text: '#166534' },
};

export default function MealPlanScreen() {
  const router = useRouter();
  const { role } = useAuthStore();
  const isAdmin = role === 'admin';
  const {
    currentPlan, mySubmission, submissionStatus, loading, generating,
    fetchPlan, fetchMySubmission, fetchSubmissionStatus, generatePlan, clearPlan,
  } = useMealPlanStore();

  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = getWeekStart(weekOffset);

  useFocusEffect(
    useCallback(() => {
      clearPlan();
      fetchPlan(weekStart);
      fetchMySubmission(weekStart);
      if (isAdmin) {
        fetchSubmissionStatus(weekStart);
      }
    }, [weekStart, isAdmin]),
  );

  const hasSubmitted = !!mySubmission;

  async function handleGenerate() {
    try {
      await generatePlan(weekStart);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 502) {
        Alert.alert('Generation failed', 'The AI could not generate a plan right now. Try again.');
      } else {
        Alert.alert('Error', 'Could not generate meal plan. Please try again.');
      }
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-3 bg-white border-b border-border">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color="#3D6B55" />
          </TouchableOpacity>
          <Text className="text-[20px] font-medium text-text-primary">Meal Plan</Text>
        </View>
        {isAdmin && (
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => setWeekOffset(w => w - 1)}
              className="w-8 h-8 rounded-full bg-bg-primary items-center justify-center"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={18} color="#7AAA96" />
            </TouchableOpacity>
            <Text className="text-[13px] font-medium text-text-muted">{formatWeekLabel(weekStart)}</Text>
            <TouchableOpacity
              onPress={() => setWeekOffset(w => w + 1)}
              className="w-8 h-8 rounded-full bg-bg-primary items-center justify-center"
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={18} color="#7AAA96" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>

        {/* Week label (family) */}
        {!isAdmin && (
          <View className="bg-white border border-border rounded-2xl p-4 flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
              <Ionicons name="calendar-outline" size={22} color="#1D9E75" />
            </View>
            <View>
              <Text className="text-[13px] text-text-faint">This week</Text>
              <Text className="text-[15px] font-semibold text-text-primary">{formatWeekLabel(weekStart)}</Text>
            </View>
          </View>
        )}

        {loading ? (
          <View className="items-center py-10 gap-2">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Loading…</Text>
          </View>
        ) : (
          <>
            {/* ── Admin view ── */}
            {isAdmin && (
              <>
                {/* Submission status card */}
                <View className="bg-white border border-border rounded-2xl p-4 gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[14px] font-semibold text-text-primary">Member submissions</Text>
                    <Text className="text-[13px] text-text-muted">
                      {submissionStatus?.submitted ?? 0} of {submissionStatus?.total ?? 0}
                    </Text>
                  </View>
                  {/* Progress bar */}
                  <View className="h-2 bg-bg-primary rounded-full overflow-hidden">
                    <View
                      className="h-2 bg-teal-500 rounded-full"
                      style={{
                        width: submissionStatus && submissionStatus.total > 0
                          ? `${Math.round((submissionStatus.submitted / submissionStatus.total) * 100)}%`
                          : '0%',
                      }}
                    />
                  </View>
                  {/* Per-member rows */}
                  {submissionStatus && submissionStatus.members.length > 0 && (
                    <View className="gap-2 mt-1">
                      {submissionStatus.members.map(m => (
                        <View key={m.user_id} className="flex-row items-center gap-2.5">
                          <View className={`w-6 h-6 rounded-full items-center justify-center ${m.submitted ? 'bg-teal-50' : 'bg-bg-primary'}`}>
                            <Ionicons
                              name={m.submitted ? 'checkmark-circle' : 'ellipse-outline'}
                              size={16}
                              color={m.submitted ? '#1D9E75' : '#A8C4B8'}
                            />
                          </View>
                          <Text className={`text-[13px] ${m.submitted ? 'text-text-primary' : 'text-text-muted'}`}>
                            {m.display_name}
                          </Text>
                          {m.submitted && (
                            <Text className="text-[11px] text-teal-600 font-medium">Submitted</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Admin's own submission */}
                <View className={`rounded-2xl p-4 border ${hasSubmitted ? 'bg-teal-50 border-teal-100' : 'bg-white border-border'}`}>
                  <View className="flex-row items-center gap-3">
                    <View className={`w-10 h-10 rounded-xl items-center justify-center ${hasSubmitted ? 'bg-teal-600' : 'bg-bg-primary'}`}>
                      <Ionicons
                        name={hasSubmitted ? 'checkmark-circle' : 'time-outline'}
                        size={22}
                        color={hasSubmitted ? '#fff' : '#7AAA96'}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-text-primary">
                        {hasSubmitted ? "Your preferences submitted ✓" : 'Add your preferences'}
                      </Text>
                      <Text className="text-[13px] text-text-muted mt-0.5">
                        {hasSubmitted
                          ? 'Your preferences are included in the plan.'
                          : 'Add your own busy days and meal requests.'}
                      </Text>
                    </View>
                  </View>
                  {!hasSubmitted && (
                    <TouchableOpacity
                      className="mt-3 bg-teal-600 rounded-xl py-3.5 flex-row items-center justify-center gap-2"
                      onPress={() => router.push('/meal-plan-submit')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="send-outline" size={18} color="#fff" />
                      <Text className="text-[14px] font-semibold text-white">Submit my week</Text>
                    </TouchableOpacity>
                  )}
                  {hasSubmitted && (
                    <TouchableOpacity
                      className="mt-3 bg-white border border-teal-200 rounded-xl py-3 flex-row items-center justify-center gap-2"
                      onPress={() => router.push('/meal-plan-submit')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="pencil-outline" size={16} color="#1D9E75" />
                      <Text className="text-[13px] font-medium text-teal-600">Edit submission</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Generate button */}
                {!currentPlan && (
                  <TouchableOpacity
                    className={`rounded-2xl py-4 flex-row items-center justify-center gap-2 ${generating ? 'bg-teal-400' : 'bg-teal-600'}`}
                    onPress={handleGenerate}
                    activeOpacity={0.85}
                    disabled={generating}
                  >
                    {generating ? (
                      <>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text className="text-[16px] font-semibold text-white">Generating plan…</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="sparkles-outline" size={20} color="#fff" />
                        <Text className="text-[16px] font-semibold text-white">Generate this week's plan</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {currentPlan && (
                  <View className="bg-white border border-border rounded-2xl p-4 gap-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-[14px] font-semibold text-text-primary">This week's plan</Text>
                      <View className={`px-2.5 py-1 rounded-full ${currentPlan.status === 'finalized' ? 'bg-teal-50' : 'bg-amber-50'}`}>
                        <Text className={`text-[11px] font-semibold capitalize ${currentPlan.status === 'finalized' ? 'text-teal-700' : 'text-amber-700'}`}>
                          {currentPlan.status}
                        </Text>
                      </View>
                    </View>
                    {currentPlan.days.slice(0, 3).map(day => (
                      <View key={day.id} className="flex-row items-center gap-2.5">
                        <Text className="text-[12px] font-medium text-text-muted w-8">{DAY_NAMES[day.day_of_week]}</Text>
                        <View
                          className="px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: PREP_COLORS[day.prep_label]?.bg }}
                        >
                          <Text className="text-[10px] font-semibold capitalize" style={{ color: PREP_COLORS[day.prep_label]?.text }}>
                            {day.prep_label}
                          </Text>
                        </View>
                        <Text className="flex-1 text-[13px] text-text-primary" numberOfLines={1}>{day.meal_name}</Text>
                      </View>
                    ))}
                    {currentPlan.days.length > 3 && (
                      <Text className="text-[12px] text-text-faint">+{currentPlan.days.length - 3} more days</Text>
                    )}
                    <TouchableOpacity
                      className="mt-1 bg-teal-600 rounded-xl py-3.5 flex-row items-center justify-center gap-2"
                      onPress={() => router.push({ pathname: '/meal-plan-review', params: { week_start: weekStart } })}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="create-outline" size={18} color="#fff" />
                      <Text className="text-[14px] font-semibold text-white">Review plan</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {/* ── Family view ── */}
            {!isAdmin && (
              <>
                {/* Submission status */}
                <View className={`rounded-2xl p-4 border ${hasSubmitted ? 'bg-teal-50 border-teal-100' : 'bg-white border-border'}`}>
                  <View className="flex-row items-center gap-3">
                    <View className={`w-10 h-10 rounded-xl items-center justify-center ${hasSubmitted ? 'bg-teal-600' : 'bg-bg-primary'}`}>
                      <Ionicons
                        name={hasSubmitted ? 'checkmark-circle' : 'time-outline'}
                        size={22}
                        color={hasSubmitted ? '#fff' : '#7AAA96'}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-text-primary">
                        {hasSubmitted ? "You've submitted ✓" : 'Submit your week'}
                      </Text>
                      <Text className="text-[13px] text-text-muted mt-0.5">
                        {hasSubmitted
                          ? 'Your preferences are in. The admin will generate the plan.'
                          : 'Tell us your busy days and meal requests.'}
                      </Text>
                    </View>
                  </View>
                  {!hasSubmitted && (
                    <TouchableOpacity
                      className="mt-3 bg-teal-600 rounded-xl py-3.5 flex-row items-center justify-center gap-2"
                      onPress={() => router.push('/meal-plan-submit')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="send-outline" size={18} color="#fff" />
                      <Text className="text-[14px] font-semibold text-white">Submit my week</Text>
                    </TouchableOpacity>
                  )}
                  {hasSubmitted && (
                    <TouchableOpacity
                      className="mt-3 bg-white border border-teal-200 rounded-xl py-3 flex-row items-center justify-center gap-2"
                      onPress={() => router.push('/meal-plan-submit')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="pencil-outline" size={16} color="#1D9E75" />
                      <Text className="text-[13px] font-medium text-teal-600">Edit submission</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* View plan (if finalized) */}
                {currentPlan?.status === 'finalized' && (
                  <TouchableOpacity
                    className="bg-white border border-border rounded-2xl p-4 flex-row items-center gap-4"
                    onPress={() => router.push('/meal-plan-view')}
                    activeOpacity={0.8}
                  >
                    <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center">
                      <Ionicons name="restaurant-outline" size={22} color="#1D9E75" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-text-primary">This week's menu is ready</Text>
                      <Text className="text-[13px] text-text-muted mt-0.5">Tap to see the full plan</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#A8C4B8" />
                  </TouchableOpacity>
                )}

                {/* Draft plan notice */}
                {currentPlan?.status === 'draft' && (
                  <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex-row items-center gap-3">
                    <Ionicons name="time-outline" size={20} color="#D97706" />
                    <Text className="flex-1 text-[13px] text-amber-700">
                      The admin is reviewing the plan. It will be available once finalized.
                    </Text>
                  </View>
                )}

                {/* No plan yet */}
                {!currentPlan && !loading && (
                  <View className="bg-white border border-border rounded-2xl p-6 items-center gap-3">
                    <Ionicons name="calendar-outline" size={36} color="#D6EDE5" />
                    <Text className="text-[14px] font-medium text-text-muted text-center">
                      No plan generated yet
                    </Text>
                    <Text className="text-[13px] text-text-faint text-center">
                      Submit your preferences so the admin can generate this week's plan.
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
