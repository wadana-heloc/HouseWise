import { create } from 'zustand';
import { cookbookService, Recipe, RecipePreview, RecipeHistoryEntry } from '../services/cookbook';
import { useAuthStore } from './authStore';

interface CookbookState {
  recipes: Recipe[];
  pendingRecipes: Recipe[];
  history: RecipeHistoryEntry[];
  personalizedDescriptions: Record<string, string>;
  loading: boolean;
  generating: boolean;
  error: string | null;

  fetchRecipes: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  submitRecipe: (data: Partial<Recipe>) => Promise<Recipe>;
  updateRecipe: (id: string, data: Partial<Recipe>) => Promise<Recipe>;
  approveRecipe: (id: string) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  generateRecipe: (prompt: string, tagHints?: string[]) => Promise<RecipePreview>;
  extractFromPhoto: (imageBase64: string, mediaType: string) => Promise<RecipePreview>;
  getPersonalizedDescription: (recipeId: string) => Promise<string>;
  reactToRecipe: (recipeId: string, reaction: 'loved' | 'okay' | 'disliked') => Promise<void>;
}

export const useCookbookStore = create<CookbookState>((set, get) => ({
  recipes: [],
  pendingRecipes: [],
  history: [],
  personalizedDescriptions: {},
  loading: false,
  generating: false,
  error: null,

  fetchRecipes: async () => {
    set({ loading: true, error: null });
    try {
      const isAdmin = useAuthStore.getState().role === 'admin';
      const [allRecipes, pending] = await Promise.all([
        cookbookService.listRecipes(),
        isAdmin ? cookbookService.listRecipes('pending') : Promise.resolve([] as Recipe[]),
      ]);
      set({
        recipes: allRecipes.filter(r => r.status === 'approved'),
        pendingRecipes: isAdmin ? pending : allRecipes.filter(r => r.status === 'pending'),
        loading: false,
      });
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  fetchHistory: async () => {
    const history = await cookbookService.getHistory();
    set({ history });
  },

  submitRecipe: async (data) => {
    const recipe = await cookbookService.submitRecipe(data);
    if (recipe.status === 'approved') {
      set(s => ({ recipes: [recipe, ...s.recipes] }));
    } else {
      set(s => ({ pendingRecipes: [recipe, ...s.pendingRecipes] }));
    }
    return recipe;
  },

  updateRecipe: async (id, data) => {
    const recipe = await cookbookService.updateRecipe(id, data);
    set(s => ({
      recipes: s.recipes.map(r => r.id === id ? recipe : r),
      pendingRecipes: s.pendingRecipes.map(r => r.id === id ? recipe : r),
    }));
    return recipe;
  },

  approveRecipe: async (id) => {
    await cookbookService.approveRecipe(id);
    set(s => {
      const recipe = s.pendingRecipes.find(r => r.id === id);
      if (!recipe) return s;
      return {
        pendingRecipes: s.pendingRecipes.filter(r => r.id !== id),
        recipes: [{ ...recipe, status: 'approved' as const }, ...s.recipes],
      };
    });
  },

  deleteRecipe: async (id) => {
    await cookbookService.deleteRecipe(id);
    set(s => ({
      recipes: s.recipes.filter(r => r.id !== id),
      pendingRecipes: s.pendingRecipes.filter(r => r.id !== id),
    }));
  },

  generateRecipe: async (prompt, tagHints = []) => {
    set({ generating: true, error: null });
    try {
      const preview = await cookbookService.generateRecipe(prompt, tagHints);
      set({ generating: false });
      return preview;
    } catch (e: any) {
      set({ generating: false, error: e.message });
      throw e;
    }
  },

  extractFromPhoto: async (imageBase64, mediaType) => {
    set({ generating: true, error: null });
    try {
      const preview = await cookbookService.extractFromPhoto(imageBase64, mediaType);
      set({ generating: false });
      return preview;
    } catch (e: any) {
      set({ generating: false, error: e.message });
      throw e;
    }
  },

  getPersonalizedDescription: async (recipeId) => {
    const cached = get().personalizedDescriptions[recipeId];
    if (cached) return cached;
    const { description } = await cookbookService.getPersonalizedDescription(recipeId);
    set(s => ({ personalizedDescriptions: { ...s.personalizedDescriptions, [recipeId]: description } }));
    return description;
  },

  reactToRecipe: async (recipeId, reaction) => {
    await cookbookService.reactToRecipe(recipeId, reaction);
    set(s => ({
      history: s.history.map(h => h.recipe_id === recipeId ? { ...h, reaction } : h),
    }));
  },
}));
