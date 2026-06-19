import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StatusBar,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCookbookStore } from '../store/cookbookStore';
import type { RecipeIngredient } from '../services/cookbook';

const AVAILABLE_TAGS = ['high_protein', 'kid_friendly', 'quick', 'vegetarian', 'low_carb', 'prep_once_eat_twice'];

type Tab = 'manual' | 'photo' | 'ai';
type RecipeSource = 'manual' | 'ai_generated' | 'photo';

interface IngredientRow {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

function emptyIngredient(): IngredientRow {
  return { name: '', quantity: '', unit: 'g', category: 'other' };
}

function stripBase64Prefix(base64: string): string {
  const idx = base64.indexOf(',');
  return idx !== -1 ? base64.slice(idx + 1) : base64;
}

function resolveMediaType(mimeType?: string | null): string {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  return mimeType && allowed.has(mimeType) ? mimeType : 'image/jpeg';
}

async function uriToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function CookbookAddScreen() {
  const router = useRouter();
  const { submitRecipe, generateRecipe, extractFromPhoto, generating } = useCookbookStore();

  const [activeTab, setActiveTab] = useState<Tab>('manual');
  const [recipeSource, setRecipeSource] = useState<RecipeSource>('manual');
  const [submitting, setSubmitting] = useState(false);

  // Form state shared across all tabs
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [story, setStory] = useState('');
  const [instructions, setInstructions] = useState('');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyIngredient()]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [prepMinutes, setPrepMinutes] = useState('');
  const [servings, setServings] = useState('');

  // AI Generate tab state
  const [prompt, setPrompt] = useState('');
  const [tagHints, setTagHints] = useState<string[]>([]);

  type PrefillData = Partial<{
    name: string | null;
    description: string | null;
    instructions: string | null;
    ingredients: RecipeIngredient[];
    tags: string[];
    prep_minutes: number | null;
    servings: number | null;
  }>;

  function prefillForm(data: PrefillData, source: RecipeSource) {
    if (data.name) setName(data.name);
    if (data.description) setDescription(data.description);
    if (data.instructions) setInstructions(data.instructions);
    if (data.ingredients?.length) {
      setIngredients(data.ingredients.map(i => ({
        name: i.name, quantity: i.quantity, unit: i.unit, category: i.category,
      })));
    }
    if (data.tags?.length) setSelectedTags(data.tags);
    if (data.prep_minutes != null) setPrepMinutes(String(data.prep_minutes));
    if (data.servings != null) setServings(String(data.servings));
    setRecipeSource(source);
    setActiveTab('manual');
  }

  function toggleTag(tag: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(tag) ? list.filter(t => t !== tag) : [...list, tag]);
  }

  function updateIngredient(index: number, field: keyof IngredientRow, value: string) {
    setIngredients(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  async function handlePickPhoto(fromCamera: boolean) {
    try {
      let result;
      if (fromCamera) {
        result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.75 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', base64: true, quality: 0.75 });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const raw = asset.base64 ?? await uriToBase64(asset.uri);
      const base64 = stripBase64Prefix(raw);
      const mediaType = resolveMediaType(asset.mimeType);
      const data = await extractFromPhoto(base64, mediaType);
      prefillForm(data, 'photo');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 502) {
        Alert.alert('Extraction failed', "Couldn't read this image — try a clearer photo.");
      } else {
        Alert.alert('Error', 'Could not process image. Please try again.');
      }
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      Alert.alert('Prompt required', 'Please describe the recipe you want.');
      return;
    }
    try {
      const recipe = await generateRecipe(prompt.trim(), tagHints);
      prefillForm(recipe, 'ai_generated');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 502) {
        Alert.alert('Generation failed', 'The AI could not generate a recipe right now. Try again.');
      } else {
        Alert.alert('Error', 'Could not generate recipe. Please try again.');
      }
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a recipe name.');
      return;
    }
    const validIngredients = ingredients.filter(i => i.name.trim());
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      story: story.trim() || null,
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
      source: recipeSource,
    };
    setSubmitting(true);
    try {
      const saved = await submitRecipe(payload);
      const title = saved.status === 'approved' ? 'Recipe added' : 'Recipe submitted';
      const message = saved.status === 'approved'
        ? 'Your recipe has been added to the cookbook.'
        : 'Your recipe has been submitted and is pending admin approval.';
      Alert.alert(title, message, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save recipe. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const tabs: { key: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'manual', label: 'Manual', icon: 'create-outline' },
    { key: 'photo', label: 'Photo', icon: 'camera-outline' },
    { key: 'ai', label: 'AI Generate', icon: 'sparkles-outline' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <Text className="flex-1 text-[20px] font-medium text-text-primary">Add recipe</Text>
      </View>

      {/* Tab bar */}
      <View className="flex-row mx-5 mt-4 bg-white border border-border rounded-xl overflow-hidden">
        {tabs.map((tab, i) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 ${active ? 'bg-teal-600' : ''} ${i > 0 ? 'border-l border-border' : ''}`}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
            >
              <Ionicons name={tab.icon} size={15} color={active ? '#fff' : '#7AAA96'} />
              <Text className={`text-[12px] font-medium ${active ? 'text-white' : 'text-text-muted'}`}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Photo tab ── */}
      {activeTab === 'photo' && (
        <View className="flex-1">
          {generating ? (
            <View className="flex-1 items-center justify-center gap-4">
              <ActivityIndicator size="large" color="#1D9E75" />
              <Text className="text-[15px] font-medium text-text-primary">Extracting recipe…</Text>
              <Text className="text-[13px] text-text-muted">This usually takes a few seconds</Text>
            </View>
          ) : (
            <View className="flex-1 items-center justify-center px-8 gap-6">
              <View className="w-20 h-20 rounded-2xl bg-teal-50 items-center justify-center">
                <Ionicons name="camera-outline" size={40} color="#1D9E75" />
              </View>
              <View className="items-center gap-2">
                <Text className="text-[17px] font-semibold text-text-primary text-center">Scan a recipe</Text>
                <Text className="text-[13px] text-text-muted text-center leading-5">
                  Take a photo of a recipe page and AI will extract all the details for you to review.
                </Text>
              </View>
              <View className="w-full gap-3">
                <TouchableOpacity
                  className="bg-teal-600 rounded-xl py-4 flex-row items-center justify-center gap-2"
                  onPress={() => handlePickPhoto(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="camera-outline" size={20} color="#fff" />
                  <Text className="text-[15px] font-semibold text-white">Take a photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="bg-white border border-border rounded-xl py-4 flex-row items-center justify-center gap-2"
                  onPress={() => handlePickPhoto(false)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="images-outline" size={20} color="#1D9E75" />
                  <Text className="text-[15px] font-semibold text-teal-600">Choose from gallery</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── AI Generate tab ── */}
      {activeTab === 'ai' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
          {generating ? (
            <View className="flex-1 items-center justify-center gap-4">
              <ActivityIndicator size="large" color="#1D9E75" />
              <Text className="text-[15px] font-medium text-text-primary">Generating recipe…</Text>
              <Text className="text-[13px] text-text-muted">AI is crafting your recipe</Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 20 }}
            >
              <View className="gap-2">
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">
                  Describe what you want
                </Text>
                <TextInput
                  className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                  placeholder="e.g. Quick pasta the kids will love, something high-protein for dinner…"
                  placeholderTextColor="#A8C4B8"
                  value={prompt}
                  onChangeText={setPrompt}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              <View className="gap-2">
                <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">
                  Tag hints (optional)
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {AVAILABLE_TAGS.map(tag => {
                    const selected = tagHints.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        className={`px-3.5 py-2 rounded-xl border ${selected ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
                        onPress={() => toggleTag(tag, tagHints, setTagHints)}
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

              <TouchableOpacity
                className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${prompt.trim() ? 'bg-teal-600' : 'bg-teal-100'}`}
                onPress={handleGenerate}
                activeOpacity={0.85}
                disabled={!prompt.trim()}
              >
                <Ionicons name="sparkles-outline" size={20} color={prompt.trim() ? '#fff' : '#A8C4B8'} />
                <Text className={`text-[16px] font-semibold ${prompt.trim() ? 'text-white' : 'text-teal-300'}`}>
                  Generate recipe
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      )}

      {/* ── Manual tab ── */}
      {activeTab === 'manual' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}
          >
            {/* Pre-fill notice */}
            {recipeSource !== 'manual' && (
              <View className="flex-row items-center gap-2 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                <Ionicons
                  name={recipeSource === 'photo' ? 'camera-outline' : 'sparkles-outline'}
                  size={16}
                  color="#1D9E75"
                />
                <Text className="flex-1 text-[13px] text-teal-700">
                  Pre-filled from {recipeSource === 'photo' ? 'photo scan' : 'AI'} — review and edit before submitting
                </Text>
              </View>
            )}

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
              <Text className="text-[12px] font-medium text-text-muted uppercase tracking-wider">About this recipe</Text>
              <TextInput
                className="bg-white border border-border rounded-xl px-4 py-3.5 text-[14px] text-text-primary"
                placeholder="Origin, family note, occasion… (optional)"
                placeholderTextColor="#A8C4B8"
                value={story}
                onChangeText={setStory}
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
                      onPress={() => toggleTag(tag, selectedTags, setSelectedTags)}
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

            {/* Submit */}
            <TouchableOpacity
              className={`rounded-xl py-4 flex-row items-center justify-center gap-2 ${submitting ? 'bg-teal-400' : 'bg-teal-600'}`}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              }
              <Text className="text-[16px] font-semibold text-white">
                {submitting ? 'Submitting…' : 'Submit recipe'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 16 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
