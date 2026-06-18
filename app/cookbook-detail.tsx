import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useCookbookStore } from '../store/cookbookStore';
import { useMemberStore } from '../store/memberStore';
import { cookbookService, Recipe } from '../services/cookbook';

export default function CookbookDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role, userId } = useAuthStore();
  const isAdmin = role === 'admin';
  const { deleteRecipe, getPersonalizedDescription } = useCookbookStore();
  const { members, fetchMembers } = useMemberStore();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [personalizedDesc, setPersonalizedDesc] = useState<string | null>(null);
  const [loadingDesc, setLoadingDesc] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    cookbookService.getRecipe(id)
      .then(setRecipe)
      .catch(() => Alert.alert('Error', 'Could not load recipe.'))
      .finally(() => setLoading(false));
    fetchMembers();
  }, [id]);

  useEffect(() => {
    if (!recipe) return;
    setLoadingDesc(true);
    getPersonalizedDescription(recipe.id)
      .then(desc => setPersonalizedDesc(desc || null))
      .catch(() => {})
      .finally(() => setLoadingDesc(false));
  }, [recipe?.id]);

  async function handleDelete() {
    if (!recipe) return;
    Alert.alert('Delete recipe', `Delete "${recipe.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteRecipe(recipe.id);
            router.back();
          } catch {
            Alert.alert('Error', 'Could not delete recipe.');
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center">
        <ActivityIndicator size="large" color="#1D9E75" />
      </SafeAreaView>
    );
  }

  if (!recipe) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary items-center justify-center px-8 gap-4">
        <Ionicons name="alert-circle-outline" size={48} color="#D6EDE5" />
        <Text className="text-[15px] text-text-muted text-center">Recipe not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-[13px] font-medium text-teal-600">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const displayDescription = personalizedDesc || recipe.description;
  const instructionSteps = recipe.instructions?.split('\n').filter(Boolean) ?? [];
  const canEdit = isAdmin || recipe.submitted_by === userId;
  const authorName = recipe.submitted_by
    ? (members.find(m => m.id === recipe.submitted_by)?.display_name ?? null)
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7F5" />

      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-3 bg-white border-b border-border">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#3D6B55" />
        </TouchableOpacity>
        <View className="flex-row items-center gap-4">
          {canEdit && (
            <TouchableOpacity onPress={() => router.push(`/cookbook-edit?id=${recipe.id}`)} hitSlop={8}>
              <Ionicons name="create-outline" size={20} color="#3D6B55" />
            </TouchableOpacity>
          )}
          {isAdmin && (
            <TouchableOpacity onPress={handleDelete} disabled={deleting} hitSlop={8}>
              {deleting
                ? <ActivityIndicator size="small" color="#EF4444" />
                : <Ionicons name="trash-outline" size={20} color="#EF4444" />
              }
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* Name + meta */}
        <View className="px-5 pt-5 pb-2">
          <Text className="text-[26px] font-semibold text-text-primary leading-tight">{recipe.name}</Text>

          <View className="flex-row items-center gap-4 mt-3 flex-wrap">
            {recipe.prep_minutes != null && (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="time-outline" size={16} color="#7AAA96" />
                <Text className="text-[13px] text-text-muted">{recipe.prep_minutes} min</Text>
              </View>
            )}
            {recipe.servings != null && (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="people-outline" size={16} color="#7AAA96" />
                <Text className="text-[13px] text-text-muted">{recipe.servings} servings</Text>
              </View>
            )}
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="sparkles-outline" size={14} color="#A8C4B8" />
              <Text className="text-[12px] text-text-faint capitalize">{recipe.source.replace(/_/g, ' ')}</Text>
            </View>
            {authorName != null && (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="person-outline" size={14} color="#A8C4B8" />
                <Text className="text-[12px] text-text-faint">{authorName}</Text>
              </View>
            )}
          </View>

          {recipe.tags.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-3">
              {recipe.tags.map(tag => (
                <View key={tag} className="bg-teal-50 border border-teal-100 rounded-full px-3 py-1">
                  <Text className="text-[12px] font-medium text-teal-700">{tag.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Personalized / canonical description */}
        {(loadingDesc || displayDescription) && (
          <View className="mx-5 mt-4 bg-teal-50 border border-teal-100 rounded-2xl p-4">
            <Text className="text-[11px] font-medium text-teal-500 uppercase tracking-wider mb-2">Why you might like it</Text>
            {loadingDesc ? (
              <View className="gap-2.5">
                <View className="h-3 bg-teal-100 rounded-md w-3/4" />
                <View className="h-3 bg-teal-100 rounded-md w-full" />
                <View className="h-3 bg-teal-100 rounded-md w-2/3" />
              </View>
            ) : (
              <Text className="text-[14px] text-teal-800 leading-5">{displayDescription}</Text>
            )}
          </View>
        )}

        {/* Story */}
        {recipe.story != null && (
          <View className="mx-5 mt-4 bg-white border border-border rounded-2xl p-4">
            <Text className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">About this recipe</Text>
            <Text className="text-[14px] text-text-primary leading-6">{recipe.story}</Text>
          </View>
        )}

        {/* Ingredients */}
        {recipe.ingredients.length > 0 && (
          <View className="px-5 mb-5">
            <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">
              Ingredients
            </Text>
            <View className="bg-white border border-border rounded-2xl overflow-hidden">
              {recipe.ingredients.map((ing, i) => (
                <View
                  key={i}
                  className={`flex-row items-center px-4 py-3.5 gap-3 ${i < recipe.ingredients.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <View className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0" />
                  <Text className="flex-1 text-[14px] text-text-primary">{ing.name}</Text>
                  <Text className="text-[13px] text-text-muted">{ing.quantity} {ing.unit}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Instructions */}
        {instructionSteps.length > 0 && (
          <View className="px-5 mb-5">
            <Text className="text-[12px] font-medium text-text-muted tracking-wider uppercase mb-3">
              Instructions
            </Text>
            <View className="gap-3">
              {instructionSteps.map((step, i) => (
                <View key={i} className="flex-row gap-3 bg-white border border-border rounded-xl px-4 py-3.5">
                  <View className="w-6 h-6 rounded-full bg-teal-50 items-center justify-center flex-shrink-0 mt-0.5">
                    <Text className="text-[12px] font-semibold text-teal-600">{i + 1}</Text>
                  </View>
                  <Text className="flex-1 text-[14px] text-text-primary leading-5">
                    {step.replace(/^\d+\.\s*/, '')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
