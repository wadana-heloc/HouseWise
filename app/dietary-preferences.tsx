import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getMe, updateDietaryPreferences } from '../services/profile';
import type { DietaryPreferences } from '../services/profile';

const DIETARY_TYPES = [
  'Vegetarian', 'Vegan', 'Halal', 'Keto',
  'Gluten-free', 'Dairy-free', 'Paleo', 'Nut-free',
];

const DEFAULT_PREFS: DietaryPreferences = {
  dietary_types: [],
  allergies: [],
  dislikes: [],
};

export default function DietaryPreferencesScreen() {
  const router = useRouter();
  const storedPrefs = useAuthStore(s => s.dietaryPreferences);
  const setDietaryPreferences = useAuthStore(s => s.setDietaryPreferences);

  const [prefs, setPrefs] = useState<DietaryPreferences>(storedPrefs ?? DEFAULT_PREFS);
  const [loading, setLoading] = useState(!storedPrefs);
  const [saving, setSaving] = useState(false);
  const savedOpacity = useRef(new Animated.Value(0)).current;

  const [allergyInput, setAllergyInput] = useState('');
  const [dislikeInput, setDislikeInput] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const me = await getMe();
        const fresh = me.user.dietary_preferences ?? DEFAULT_PREFS;
        setPrefs(fresh);
        setDietaryPreferences(fresh);
      } catch {
        // fall back to stored prefs
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function showSaved() {
    savedOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(800),
      Animated.timing(savedOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }

  async function save(updated: DietaryPreferences) {
    setSaving(true);
    try {
      const result = await updateDietaryPreferences(updated);
      setPrefs(result);
      setDietaryPreferences(result);
      showSaved();
    } catch {
      // keep local state; will retry on next change
    } finally {
      setSaving(false);
    }
  }

  function toggleType(type: string) {
    const updated = {
      ...prefs,
      dietary_types: prefs.dietary_types.includes(type)
        ? prefs.dietary_types.filter(t => t !== type)
        : [...prefs.dietary_types, type],
    };
    setPrefs(updated);
    save(updated);
  }

  function addAllergy() {
    const val = allergyInput.trim();
    if (!val || prefs.allergies.some(a => a.toLowerCase() === val.toLowerCase())) return;
    const updated = { ...prefs, allergies: [...prefs.allergies, val] };
    setPrefs(updated);
    setAllergyInput('');
    save(updated);
  }

  function removeAllergy(item: string) {
    const updated = { ...prefs, allergies: prefs.allergies.filter(a => a !== item) };
    setPrefs(updated);
    save(updated);
  }

  function addDislike() {
    const val = dislikeInput.trim();
    if (!val || prefs.dislikes.some(d => d.toLowerCase() === val.toLowerCase())) return;
    const updated = { ...prefs, dislikes: [...prefs.dislikes, val] };
    setPrefs(updated);
    setDislikeInput('');
    save(updated);
  }

  function removeDislike(item: string) {
    const updated = { ...prefs, dislikes: prefs.dislikes.filter(d => d !== item) };
    setPrefs(updated);
    save(updated);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Dietary preferences</Text>
        <View className="w-16 h-6 items-end justify-center">
          {saving ? (
            <ActivityIndicator size="small" color="#1D9E75" />
          ) : (
            <Animated.View style={{ opacity: savedOpacity }} className="flex-row items-center gap-1">
              <Ionicons name="checkmark-circle" size={14} color="#1D9E75" />
              <Text className="text-[12px] font-medium text-teal-600">Saved</Text>
            </Animated.View>
          )}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 48 }}
        >
          <Text className="text-[13px] text-text-muted px-1">
            Set your dietary needs once — they're included in every meal plan submission automatically.
          </Text>

          {/* Dietary type */}
          <View className="gap-3">
            <View>
              <Text className="text-[14px] font-semibold text-text-primary">Dietary type</Text>
              <Text className="text-[13px] text-text-muted mt-0.5">Select all that apply.</Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {DIETARY_TYPES.map(type => {
                const selected = prefs.dietary_types.includes(type);
                return (
                  <TouchableOpacity
                    key={type}
                    className={`px-4 py-2.5 rounded-xl border ${selected ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => toggleType(type)}
                    activeOpacity={0.8}
                  >
                    <Text className={`text-[14px] font-medium ${selected ? 'text-white' : 'text-text-muted'}`}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Allergies */}
          <View className="gap-3">
            <View>
              <Text className="text-[14px] font-semibold text-text-primary">Allergies</Text>
              <Text className="text-[13px] text-text-muted mt-0.5">Ingredients to always avoid.</Text>
            </View>
            {prefs.allergies.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {prefs.allergies.map(item => (
                  <View
                    key={item}
                    className="flex-row items-center gap-1.5 bg-red-50 border border-red-100 rounded-xl px-3 py-2"
                  >
                    <Ionicons name="warning-outline" size={13} color="#DC2626" />
                    <Text className="text-[13px] font-medium text-red-700">{item}</Text>
                    <TouchableOpacity onPress={() => removeAllergy(item)} hitSlop={8}>
                      <Ionicons name="close" size={14} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <View className="flex-row gap-2">
              <TextInput
                className="flex-1 bg-white border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
                placeholder="e.g. Gluten, Peanuts, Shellfish…"
                placeholderTextColor="#A8C4B8"
                value={allergyInput}
                onChangeText={setAllergyInput}
                onSubmitEditing={addAllergy}
                returnKeyType="done"
              />
              <TouchableOpacity
                className={`w-12 rounded-xl items-center justify-center ${allergyInput.trim() ? 'bg-red-500' : 'bg-red-100'}`}
                onPress={addAllergy}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={22} color={allergyInput.trim() ? '#fff' : '#FCA5A5'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Dislikes */}
          <View className="gap-3">
            <View>
              <Text className="text-[14px] font-semibold text-text-primary">Dislikes</Text>
              <Text className="text-[13px] text-text-muted mt-0.5">Things you'd rather not eat.</Text>
            </View>
            {prefs.dislikes.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {prefs.dislikes.map(item => (
                  <View
                    key={item}
                    className="flex-row items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2"
                  >
                    <Ionicons name="thumbs-down-outline" size={13} color="#D97706" />
                    <Text className="text-[13px] font-medium text-amber-700">{item}</Text>
                    <TouchableOpacity onPress={() => removeDislike(item)} hitSlop={8}>
                      <Ionicons name="close" size={14} color="#D97706" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <View className="flex-row gap-2">
              <TextInput
                className="flex-1 bg-white border border-border rounded-xl px-4 py-3 text-[14px] text-text-primary"
                placeholder="e.g. Broccoli, Mushrooms, Anchovies…"
                placeholderTextColor="#A8C4B8"
                value={dislikeInput}
                onChangeText={setDislikeInput}
                onSubmitEditing={addDislike}
                returnKeyType="done"
              />
              <TouchableOpacity
                className={`w-12 rounded-xl items-center justify-center ${dislikeInput.trim() ? 'bg-amber-500' : 'bg-amber-100'}`}
                onPress={addDislike}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={22} color={dislikeInput.trim() ? '#fff' : '#FCD34D'} />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
