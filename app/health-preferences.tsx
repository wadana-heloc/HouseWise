import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  StatusBar,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getMe, updateHealthPreferences } from '../services/profile';
import type { HealthPreferences } from '../services/profile';

const PREFS: {
  key: keyof HealthPreferences;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    key: 'high_protein',
    label: 'High Protein',
    description: 'Prioritise protein-rich foods',
    icon: 'barbell-outline',
  },
  {
    key: 'low_calories',
    label: 'Low Calories',
    description: 'Focus on lower-calorie options',
    icon: 'flame-outline',
  },
  {
    key: 'low_carbs',
    label: 'Low Carbs',
    description: 'Reduce carbohydrate intake',
    icon: 'leaf-outline',
  },
  {
    key: 'low_sugar',
    label: 'Low Sugar',
    description: 'Limit added sugars',
    icon: 'nutrition-outline',
  },
  {
    key: 'whole_grain',
    label: 'Whole Grain',
    description: 'Choose whole grain products',
    icon: 'sunny-outline',
  },
];

const DEFAULT_PREFS: HealthPreferences = {
  high_protein: false,
  low_calories: false,
  low_carbs: false,
  low_sugar: false,
  whole_grain: false,
};

export default function HealthPreferencesScreen() {
  const router = useRouter();
  const storedPrefs = useAuthStore((s) => s.healthPreferences);
  const setHealthPreferences = useAuthStore((s) => s.setHealthPreferences);

  const [prefs, setPrefs] = useState<HealthPreferences>(storedPrefs ?? DEFAULT_PREFS);
  const [loading, setLoading] = useState(!storedPrefs);
  const [savingKey, setSavingKey] = useState<keyof HealthPreferences | null>(null);
  const [savedKey, setSavedKey] = useState<keyof HealthPreferences | null>(null);
  const savedOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    async function fetchPrefs() {
      try {
        const me = await getMe();
        const fresh = me.user.health_preferences;
        setPrefs(fresh);
        setHealthPreferences(fresh);
      } catch {
        // fall back to stored prefs if fetch fails
      } finally {
        setLoading(false);
      }
    }
    fetchPrefs();
  }, []);

  function showSavedIndicator(key: keyof HealthPreferences) {
    setSavedKey(key);
    savedOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(800),
      Animated.timing(savedOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setSavedKey(null));
  }

  async function handleToggle(key: keyof HealthPreferences, value: boolean) {
    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    setSavingKey(key);
    try {
      const updated = await updateHealthPreferences({ [key]: value });
      setPrefs(updated);
      setHealthPreferences(updated);
      showSavedIndicator(key);
    } catch {
      setPrefs((p) => ({ ...p, [key]: previous }));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      <View className="px-5 pt-4 pb-3 bg-white border-b border-border flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Health preferences</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 20 }}
        >
          <Text className="text-[13px] text-text-muted px-1">
            Turn on the filters that match your dietary goals. Your selections are saved instantly.
          </Text>

          <View className="bg-white border border-border rounded-xl overflow-hidden">
            {PREFS.map((item, i) => {
              const isLast = i === PREFS.length - 1;
              const isSaving = savingKey === item.key;
              const isSaved = savedKey === item.key;

              return (
                <View
                  key={item.key}
                  className={`flex-row items-center px-4 py-3.5 gap-3 ${!isLast ? 'border-b border-border' : ''}`}
                >
                  <View className="w-9 h-9 rounded-lg bg-teal-50 items-center justify-center">
                    <Ionicons name={item.icon as any} size={18} color="#1D9E75" />
                  </View>

                  <View className="flex-1">
                    <Text className="text-[14px] font-medium text-text-primary">{item.label}</Text>
                    <Text className="text-[12px] text-text-muted mt-0.5">{item.description}</Text>
                  </View>

                  <View className="items-end gap-0.5">
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#1D9E75" />
                    ) : isSaved ? (
                      <Animated.View
                        style={{ opacity: savedOpacity }}
                        className="flex-row items-center gap-1"
                      >
                        <Ionicons name="checkmark-circle" size={14} color="#1D9E75" />
                        <Text className="text-[11px] font-medium text-teal-600">Saved</Text>
                      </Animated.View>
                    ) : (
                      <View style={{ height: 18 }} />
                    )}
                    <Switch
                      value={prefs[item.key]}
                      onValueChange={(v) => handleToggle(item.key, v)}
                      disabled={isSaving}
                      trackColor={{ false: '#E5EDE9', true: '#1D9E75' }}
                      thumbColor="#ffffff"
                    />
                  </View>
                </View>
              );
            })}
          </View>

          <View style={{ height: 16 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
