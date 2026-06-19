import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useCookbookStore } from '../store/cookbookStore';

const TAGS = ['All', 'high_protein', 'kid_friendly', 'quick', 'vegetarian'];
const TAG_LABELS: Record<string, string> = {
  All: 'All',
  high_protein: 'High Protein',
  kid_friendly: 'Kid Friendly',
  quick: 'Quick',
  vegetarian: 'Vegetarian',
};

export default function CookbookScreen() {
  const router = useRouter();
  const { role } = useAuthStore();
  const isAdmin = role === 'admin';
  const { recipes, pendingRecipes, loading, fetchRecipes, approveRecipe, deleteRecipe } = useCookbookStore();

  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('All');

  useFocusEffect(useCallback(() => { fetchRecipes(); }, []));

  const filtered = recipes.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase());
    const matchTag = selectedTag === 'All' || r.tags.includes(selectedTag);
    return matchSearch && matchTag;
  });

  async function handleApprove(id: string) {
    try { await approveRecipe(id); }
    catch { Alert.alert('Error', 'Could not approve recipe. Try again.'); }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert('Delete recipe', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteRecipe(id); }
          catch { Alert.alert('Error', 'Could not delete recipe. Try again.'); }
        },
      },
    ]);
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
          <Text className="text-[20px] font-medium text-text-primary">Cookbook</Text>
        </View>
        <TouchableOpacity
          className="flex-row items-center gap-1.5 bg-teal-600 rounded-xl px-3.5 py-2"
          onPress={() => router.push('/cookbook-add')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text className="text-[13px] font-semibold text-white">Add recipe</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

        {/* Pending section — admin only */}
        {isAdmin && pendingRecipes.length > 0 && (
          <View className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 gap-3">
            <Text className="text-[13px] font-semibold text-amber-700">
              {pendingRecipes.length} recipe{pendingRecipes.length > 1 ? 's' : ''} awaiting approval
            </Text>
            {pendingRecipes.map(recipe => (
              <View
                key={recipe.id}
                className="flex-row items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-amber-100"
              >
                <View className="flex-1">
                  <Text className="text-[14px] font-medium text-text-primary" numberOfLines={1}>{recipe.name}</Text>
                  <Text className="text-[11px] text-text-muted mt-0.5 capitalize">
                    {recipe.source.replace('_', ' ')}
                  </Text>
                </View>
                <TouchableOpacity
                  className="bg-teal-600 rounded-lg px-3 py-1.5"
                  onPress={() => handleApprove(recipe.id)}
                  activeOpacity={0.85}
                >
                  <Text className="text-[12px] font-semibold text-white">Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="bg-white rounded-lg px-3 py-1.5 border border-red-200"
                  onPress={() => handleDelete(recipe.id, recipe.name)}
                  activeOpacity={0.85}
                >
                  <Text className="text-[12px] font-semibold text-red-500">Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Search bar */}
        <View className="mx-5 mt-4 flex-row items-center bg-white border border-border rounded-xl px-3.5 gap-2">
          <Ionicons name="search-outline" size={18} color="#A8C4B8" />
          <TextInput
            className="flex-1 py-3 text-[14px] text-text-primary"
            placeholder="Search recipes…"
            placeholderTextColor="#A8C4B8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#A8C4B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Tag filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}
        >
          {TAGS.map(tag => (
            <TouchableOpacity
              key={tag}
              className={`px-3.5 py-2 rounded-xl border ${selectedTag === tag ? 'bg-teal-600 border-teal-600' : 'bg-white border-border'}`}
              onPress={() => setSelectedTag(tag)}
              activeOpacity={0.8}
            >
              <Text className={`text-[13px] font-medium ${selectedTag === tag ? 'text-white' : 'text-text-muted'}`}>
                {TAG_LABELS[tag] ?? tag}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Recipe grid */}
        {loading ? (
          <View className="items-center py-16 gap-2">
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text className="text-[13px] text-text-muted">Loading recipes…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View className="items-center py-16 gap-3 px-8">
            <Ionicons name="book-outline" size={48} color="#D6EDE5" />
            <Text className="text-[15px] font-medium text-text-muted text-center">
              {search || selectedTag !== 'All' ? 'No recipes match your filter' : 'No recipes yet'}
            </Text>
            <Text className="text-[13px] text-text-faint text-center">
              Tap "Add recipe" to create your first one
            </Text>
          </View>
        ) : (
          <View className="px-5 flex-row flex-wrap gap-3">
            {filtered.map(recipe => (
              <TouchableOpacity
                key={recipe.id}
                className="bg-white border border-border rounded-2xl p-4 gap-2"
                style={{ width: '47.5%' }}
                onPress={() => router.push(`/cookbook-detail?id=${recipe.id}`)}
                activeOpacity={0.8}
              >
                <View className="w-10 h-10 rounded-xl bg-teal-50 items-center justify-center mb-1">
                  <Ionicons name="restaurant-outline" size={22} color="#1D9E75" />
                </View>
                <Text className="text-[14px] font-semibold text-text-primary" numberOfLines={2}>
                  {recipe.name}
                </Text>
                {recipe.prep_minutes != null && (
                  <View className="flex-row items-center gap-1">
                    <Ionicons name="time-outline" size={13} color="#A8C4B8" />
                    <Text className="text-[12px] text-text-faint">{recipe.prep_minutes} min</Text>
                  </View>
                )}
                {recipe.tags.length > 0 && (
                  <View className="flex-row flex-wrap gap-1 mt-0.5">
                    {recipe.tags.slice(0, 2).map(t => (
                      <View key={t} className="bg-teal-50 rounded-md px-2 py-0.5">
                        <Text className="text-[10px] text-teal-700">{t.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
