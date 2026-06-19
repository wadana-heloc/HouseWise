import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMealPlanStore } from '../store/mealPlanStore';
import { useCookbookStore } from '../store/cookbookStore';
import { useAuthStore } from '../store/authStore';
import { getMe } from '../services/profile';

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
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

interface RequestItem {
  id: string;
  type: 'specific' | 'new';
  description: string;
  recipe_id: string | null;
  recipe_name: string;
}

export default function MealPlanSubmitScreen() {
  const router = useRouter();
  const weekStart = getThisWeekStart();
  const { upsertSubmission, fetchMySubmission } = useMealPlanStore();
  const { recipes, fetchRecipes } = useCookbookStore();

  const dietaryPrefs = useAuthStore(s => s.dietaryPreferences);
  const setDietaryPreferences = useAuthStore(s => s.setDietaryPreferences);

  const [busyDays, setBusyDays] = useState<number[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [weekNotes, setWeekNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Add request form state
  const [addType, setAddType] = useState<'specific' | 'new'>('new');
  const [addDescription, setAddDescription] = useState('');
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedRecipeName, setSelectedRecipeName] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');

  useFocusEffect(useCallback(() => {
    fetchRecipes();
    fetchMySubmission(weekStart).then(sub => {
      if (sub) {
        setBusyDays(sub.busy_days);
        setWeekNotes(sub.week_notes ?? '');
        setRequests(sub.meal_requests.map((r, i) => ({
          id: `loaded-${i}`,
          type: r.recipe_id ? 'specific' : 'new',
          description: r.recipe_id ? '' : (r.description ?? ''),
          recipe_id: r.recipe_id,
          recipe_name: r.recipe_id ? (r.description ?? '') : '',
        })));
      } else {
        setBusyDays([]);
        setRequests([]);
        setWeekNotes('');
      }
    });
    if (!dietaryPrefs) {
      getMe().then(me => {
        setDietaryPreferences(me.user.dietary_preferences ?? { dietary_types: [], allergies: [], dislikes: [] });
      }).catch(() => {});
    }
  }, [weekStart]));

  function toggleDay(value: number) {
    setBusyDays(prev =>
      prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value]
    );
  }

  function addRequest() {
    if (addType === 'new' && !addDescription.trim()) return;
    if (addType === 'specific' && !selectedRecipeId) return;

    setRequests(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        type: addType,
        description: addType === 'new' ? addDescription.trim() : '',
        recipe_id: addType === 'specific' ? selectedRecipeId : null,
        recipe_name: addType === 'specific' ? selectedRecipeName : '',
      },
    ]);
    setAddDescription('');
    setSelectedRecipeId(null);
    setSelectedRecipeName('');
    setAddType('new');
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await upsertSubmission({
        week_start: weekStart,
        busy_days: busyDays,
        meal_requests: requests.map(r => ({
          description: r.type === 'specific' ? r.recipe_name : r.description,
          recipe_id: r.type === 'specific' ? r.recipe_id : null,
        })),
        week_notes: weekNotes.trim() || null,
      });
      Alert.alert('Submitted!', 'Your preferences have been sent to the admin.', [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not submit preferences. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredRecipes = recipes.filter(r =>
    r.name.toLowerCase().includes(recipeSearch.toLowerCase())
  );

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Submit my week</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 48 }}
      >
        {/* Busy days */}
        <View className="gap-3">
          <View>
            <Text className="text-[14px] font-semibold text-text-primary">Busy days</Text>
            <Text className="text-[13px] text-text-muted mt-0.5">
              Mark days you can't cook — the AI will schedule lighter meals.
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {DAYS.map(day => {
              const selected = busyDays.includes(day.value);
              return (
                <TouchableOpacity
                  key={day.value}
                  className={`px-4 py-2.5 rounded-xl border ${selected ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                  onPress={() => toggleDay(day.value)}
                  activeOpacity={0.8}
                >
                  <Text className={`text-[14px] font-medium ${selected ? 'text-white' : 'text-text-muted'}`}>
                    {day.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Dietary preferences summary */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-[14px] font-semibold text-text-primary">Your dietary preferences</Text>
              <Text className="text-[13px] text-text-muted mt-0.5">Applied automatically to every plan.</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/dietary-preferences')}
              className="flex-row items-center gap-1 bg-teal-50 rounded-xl px-3 py-1.5"
              hitSlop={8}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil-outline" size={13} color="#1D9E75" />
              <Text className="text-[12px] font-medium text-teal-600">Edit</Text>
            </TouchableOpacity>
          </View>

          {dietaryPrefs && (
            dietaryPrefs.dietary_types.length === 0 && dietaryPrefs.allergies.length === 0 && dietaryPrefs.dislikes.length === 0
              ? (
                <TouchableOpacity
                  className="bg-white border border-dashed border-border rounded-xl px-4 py-3.5 flex-row items-center gap-3"
                  onPress={() => router.push('/dietary-preferences')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add-circle-outline" size={20} color="#A8C4B8" />
                  <Text className="text-[13px] text-text-faint">No preferences set — tap to add</Text>
                </TouchableOpacity>
              ) : (
                <View className="bg-white border border-border rounded-xl px-4 py-3 gap-2.5">
                  {dietaryPrefs.dietary_types.length > 0 && (
                    <View className="flex-row flex-wrap gap-1.5">
                      {dietaryPrefs.dietary_types.map(t => (
                        <View key={t} className="bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1">
                          <Text className="text-[12px] font-medium text-teal-700">{t}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {dietaryPrefs.allergies.length > 0 && (
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Ionicons name="warning-outline" size={13} color="#DC2626" />
                      <Text className="text-[12px] text-red-600 font-medium">
                        Allergies: {dietaryPrefs.allergies.join(', ')}
                      </Text>
                    </View>
                  )}
                  {dietaryPrefs.dislikes.length > 0 && (
                    <View className="flex-row items-center gap-2 flex-wrap">
                      <Ionicons name="thumbs-down-outline" size={13} color="#D97706" />
                      <Text className="text-[12px] text-amber-600 font-medium">
                        Dislikes: {dietaryPrefs.dislikes.join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
              )
          )}

          {!dietaryPrefs && (
            <TouchableOpacity
              className="bg-white border border-dashed border-border rounded-xl px-4 py-3.5 flex-row items-center gap-3"
              onPress={() => router.push('/dietary-preferences')}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={20} color="#A8C4B8" />
              <Text className="text-[13px] text-text-faint">No preferences set — tap to add</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Meal requests */}
        <View className="gap-3">
          <View>
            <Text className="text-[14px] font-semibold text-text-primary">Meal requests</Text>
            <Text className="text-[13px] text-text-muted mt-0.5">
              Pick a specific recipe or describe what you're in the mood for.
            </Text>
          </View>

          {/* Existing requests */}
          {requests.length > 0 && (
            <View className="gap-2">
              {requests.map(req => (
                <View
                  key={req.id}
                  className="flex-row items-center gap-3 bg-white border border-border rounded-xl px-4 py-3"
                >
                  <Ionicons
                    name={req.type === 'specific' ? 'restaurant-outline' : 'chatbubble-outline'}
                    size={16}
                    color="#7AAA96"
                  />
                  <Text className="flex-1 text-[14px] text-text-primary" numberOfLines={2}>
                    {req.type === 'specific' ? req.recipe_name : req.description}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setRequests(prev => prev.filter(r => r.id !== req.id))}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle-outline" size={20} color="#A8C4B8" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Add request form */}
          <View className="bg-white border border-border rounded-2xl p-4 gap-3">
            {/* Type toggle */}
            <View className="flex-row bg-bg-primary rounded-xl overflow-hidden border border-border">
              <TouchableOpacity
                className={`flex-1 py-2.5 items-center ${addType === 'new' ? 'bg-teal-600' : ''}`}
                onPress={() => setAddType('new')}
                activeOpacity={0.8}
              >
                <Text className={`text-[13px] font-medium ${addType === 'new' ? 'text-white' : 'text-text-muted'}`}>
                  Something new
                </Text>
              </TouchableOpacity>
              <View className="w-px bg-border" />
              <TouchableOpacity
                className={`flex-1 py-2.5 items-center ${addType === 'specific' ? 'bg-teal-600' : ''}`}
                onPress={() => setAddType('specific')}
                activeOpacity={0.8}
              >
                <Text className={`text-[13px] font-medium ${addType === 'specific' ? 'text-white' : 'text-text-muted'}`}>
                  Specific recipe
                </Text>
              </TouchableOpacity>
            </View>

            {addType === 'new' ? (
              <TextInput
                className="bg-bg-primary border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
                placeholder="e.g. Something light, burgers, a spicy curry…"
                placeholderTextColor="#A8C4B8"
                value={addDescription}
                onChangeText={setAddDescription}
              />
            ) : (
              <TouchableOpacity
                className="flex-row items-center gap-3 bg-bg-primary border border-border rounded-xl px-4 py-3"
                onPress={() => setShowRecipePicker(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="restaurant-outline" size={18} color="#7AAA96" />
                <Text className={`flex-1 text-[14px] ${selectedRecipeId ? 'text-text-primary' : 'text-text-faint'}`}>
                  {selectedRecipeId ? selectedRecipeName : 'Pick from cookbook…'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#A8C4B8" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              className={`rounded-xl py-3 flex-row items-center justify-center gap-2 ${
                (addType === 'new' && addDescription.trim()) || (addType === 'specific' && selectedRecipeId)
                  ? 'bg-teal-600'
                  : 'bg-teal-100'
              }`}
              onPress={addRequest}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color={
                (addType === 'new' && addDescription.trim()) || (addType === 'specific' && selectedRecipeId)
                  ? '#fff' : '#A8C4B8'
              } />
              <Text className={`text-[14px] font-semibold ${
                (addType === 'new' && addDescription.trim()) || (addType === 'specific' && selectedRecipeId)
                  ? 'text-white' : 'text-teal-300'
              }`}>
                Add request
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Week notes */}
        <View className="gap-3">
          <View>
            <Text className="text-[14px] font-semibold text-text-primary">Anything extra this week?</Text>
            <Text className="text-[13px] text-text-muted mt-0.5">One-off notes just for this week.</Text>
          </View>
          <TextInput
            className="bg-white border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
            placeholder="e.g. Extra spicy please, birthday dinner on Saturday…"
            placeholderTextColor="#A8C4B8"
            value={weekNotes}
            onChangeText={setWeekNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={2000}
          />
        </View>

        {/* Submit button */}
        <TouchableOpacity
          className={`rounded-2xl py-4 flex-row items-center justify-center gap-2 ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="send-outline" size={20} color="#fff" />
          }
          <Text className="text-[16px] font-semibold text-white">
            {submitting ? 'Submitting…' : 'Submit preferences'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Recipe picker modal */}
      <Modal visible={showRecipePicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView className="flex-1 bg-bg-primary">
          <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
            <TouchableOpacity onPress={() => { setShowRecipePicker(false); setRecipeSearch(''); }} hitSlop={8}>
              <Ionicons name="close" size={22} color="#3D6B55" />
            </TouchableOpacity>
            <Text className="flex-1 text-[18px] font-medium text-text-primary">Pick a recipe</Text>
          </View>
          <View className="mx-5 mt-4 flex-row items-center bg-white border border-border rounded-xl px-3.5 gap-2">
            <Ionicons name="search-outline" size={18} color="#A8C4B8" />
            <TextInput
              className="flex-1 py-3 text-[14px] text-text-primary"
              placeholder="Search…"
              placeholderTextColor="#A8C4B8"
              value={recipeSearch}
              onChangeText={setRecipeSearch}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
            {filteredRecipes.map(recipe => (
              <TouchableOpacity
                key={recipe.id}
                className="flex-row items-center gap-3 bg-white border border-border rounded-xl px-4 py-3.5"
                onPress={() => {
                  setSelectedRecipeId(recipe.id);
                  setSelectedRecipeName(recipe.name);
                  setShowRecipePicker(false);
                  setRecipeSearch('');
                }}
                activeOpacity={0.8}
              >
                <View className="w-8 h-8 rounded-lg bg-teal-50 items-center justify-center">
                  <Ionicons name="restaurant-outline" size={16} color="#1D9E75" />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-medium text-text-primary">{recipe.name}</Text>
                  {recipe.prep_minutes != null && (
                    <Text className="text-[12px] text-text-faint mt-0.5">{recipe.prep_minutes} min</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color="#A8C4B8" />
              </TouchableOpacity>
            ))}
            {filteredRecipes.length === 0 && (
              <View className="items-center py-12 gap-2">
                <Ionicons name="book-outline" size={36} color="#D6EDE5" />
                <Text className="text-[13px] text-text-muted">No recipes found</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
