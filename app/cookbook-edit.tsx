import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCookbookStore } from '../store/cookbookStore';
import { cookbookService } from '../services/cookbook';
import type { RecipeIngredient } from '../services/cookbook';

const AVAILABLE_TAGS = ['high_protein', 'kid_friendly', 'quick', 'vegetarian', 'low_carb', 'prep_once_eat_twice'];

interface IngredientRow {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

function emptyIngredient(): IngredientRow {
  return { name: '', quantity: '', unit: 'g', category: 'other' };
}

export default function CookbookEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { updateRecipe } = useCookbookStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [story, setStory] = useState('');
  const [hasStory, setHasStory] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyIngredient()]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [prepMinutes, setPrepMinutes] = useState('');
  const [servings, setServings] = useState('');

  useEffect(() => {
    if (!id) return;
    cookbookService.getRecipe(id)
      .then(recipe => {
        setName(recipe.name);
        setDescription(recipe.description ?? '');
        setStory(recipe.story ?? '');
        setHasStory(recipe.story != null);
        setInstructions(recipe.instructions ?? '');
        setIngredients(
          recipe.ingredients.length
            ? recipe.ingredients.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, category: i.category }))
            : [emptyIngredient()]
        );
        setSelectedTags(recipe.tags);
        setPrepMinutes(recipe.prep_minutes != null ? String(recipe.prep_minutes) : '');
        setServings(recipe.servings != null ? String(recipe.servings) : '');
      })
      .catch(() => Alert.alert('Error', 'Could not load recipe.'))
      .finally(() => setLoading(false));
  }, [id]);

  function toggleTag(tag: string) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  function updateIngredient(index: number, field: keyof IngredientRow, value: string) {
    setIngredients(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  function handleClearStory() {
    Alert.alert('Clear story', 'Remove the story from this recipe?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: () => { setStory(''); setHasStory(false); },
      },
    ]);
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a recipe name.');
      return;
    }
    const validIngredients = ingredients.filter(i => i.name.trim());
    const storyValue = hasStory ? (story.trim() || null) : null;

    if (hasStory && story.trim().length === 0) {
      Alert.alert('Story is empty', 'Enter a story or clear it using the × button.');
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      story: storyValue,
      instructions: instructions.trim() || null,
      ingredients: validIngredients.map(i => ({
        name: i.name.trim(),
        quantity: i.quantity || '1',
        unit: i.unit || 'g',
        category: i.category || 'other',
      })),
      tags: selectedTags,
      prep_minutes: prepMinutes ? (parseInt(prepMinutes) || null) : null,
      servings: servings ? (parseInt(servings) || null) : null,
    };

    setSaving(true);
    try {
      await updateRecipe(id!, payload);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator size="large" color="#1D9E75" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Edit recipe</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}
        >
          {/* Name */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Recipe name *</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[15px] text-text-primary"
              placeholder="e.g. Chicken Tikka Masala"
              placeholderTextColor="#A8C4B8"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Description */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Description</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
              placeholder="A short description of the dish…"
              placeholderTextColor="#A8C4B8"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Story */}
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">About this recipe</Text>
              {hasStory && (
                <TouchableOpacity onPress={handleClearStory} hitSlop={8} className="flex-row items-center gap-1">
                  <Ionicons name="close-circle-outline" size={16} color="#A8C4B8" />
                  <Text className="text-[12px] text-text-faint">Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
              placeholder="Origin, family note, occasion… (optional)"
              placeholderTextColor="#A8C4B8"
              value={story}
              onChangeText={v => { setStory(v); setHasStory(true); }}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={5000}
            />
          </View>

          {/* Prep time + Servings */}
          <View className="flex-row gap-3">
            <View className="gap-2" style={{ flex: 1 }}>
              <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Prep (min)</Text>
              <TextInput
                className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                placeholder="30"
                placeholderTextColor="#A8C4B8"
                value={prepMinutes}
                onChangeText={setPrepMinutes}
                keyboardType="number-pad"
              />
            </View>
            <View className="gap-2" style={{ flex: 1 }}>
              <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Servings</Text>
              <TextInput
                className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                placeholder="4"
                placeholderTextColor="#A8C4B8"
                value={servings}
                onChangeText={setServings}
                keyboardType="number-pad"
              />
            </View>
          </View>

          {/* Tags */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Tags</Text>
            <View className="flex-row flex-wrap gap-2">
              {AVAILABLE_TAGS.map(tag => {
                const selected = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    className={`px-3.5 py-2 rounded-xl border ${selected ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                    onPress={() => toggleTag(tag)}
                    activeOpacity={0.8}
                  >
                    <Text className={`text-[13px] font-medium ${selected ? 'text-white' : 'text-text-muted'}`}>
                      {tag.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Ingredients */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Ingredients</Text>
            <View className="gap-2">
              {ingredients.map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    className="bg-white border border-border rounded-xl px-3 py-3 text-[14px] text-text-primary"
                    style={{ flex: 3 }}
                    placeholder="Ingredient"
                    placeholderTextColor="#A8C4B8"
                    value={row.name}
                    onChangeText={v => updateIngredient(i, 'name', v)}
                  />
                  <TextInput
                    className="bg-white border border-border rounded-xl px-2 py-3 text-[14px] text-text-primary text-center"
                    style={{ flex: 1.2 }}
                    placeholder="Qty"
                    placeholderTextColor="#A8C4B8"
                    value={row.quantity}
                    onChangeText={v => updateIngredient(i, 'quantity', v)}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    className="bg-white border border-border rounded-xl px-2 py-3 text-[14px] text-text-primary text-center"
                    style={{ flex: 1 }}
                    placeholder="g"
                    placeholderTextColor="#A8C4B8"
                    value={row.unit}
                    onChangeText={v => updateIngredient(i, 'unit', v)}
                  />
                  {ingredients.length > 1 && (
                    <TouchableOpacity
                      onPress={() => setIngredients(prev => prev.filter((_, idx) => idx !== i))}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle-outline" size={22} color="#A8C4B8" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity
                className="flex-row items-center gap-2 py-1 px-1"
                onPress={() => setIngredients(prev => [...prev, emptyIngredient()])}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={20} color="#1D9E75" />
                <Text className="text-[13px] font-medium text-teal-600">Add ingredient</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Instructions */}
          <View className="gap-2">
            <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">Instructions</Text>
            <TextInput
              className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
              placeholder={"1. Preheat oven to 200°C\n2. Mix ingredients together\n3. Bake for 25 minutes…"}
              placeholderTextColor="#A8C4B8"
              value={instructions}
              onChangeText={setInstructions}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          {/* Save */}
          <TouchableOpacity
            className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${saving ? 'bg-teal-400' : 'bg-teal-600'}`}
            onPress={handleSave}
            activeOpacity={0.85}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            }
            <Text className="text-[16px] font-semibold text-white">
              {saving ? 'Saving…' : 'Save changes'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
