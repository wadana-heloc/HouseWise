import api from './api';

export interface RecipeIngredient {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

export interface Recipe {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  instructions: string | null;
  tags: string[];
  prep_minutes: number | null;
  servings: number | null;
  source: 'manual' | 'ai_generated' | 'photo';
  status: 'pending' | 'approved';
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipePreview {
  name: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  instructions: string | null;
  tags: string[];
  prep_minutes: number | null;
  servings: number | null;
  source: 'manual' | 'ai_generated' | 'photo';
}

export interface RecipeHistoryEntry {
  id: string;
  recipe_id: string;
  reaction: 'loved' | 'okay' | 'disliked' | null;
  created_at: string;
}

export const cookbookService = {
  listRecipes: (status?: 'approved' | 'pending') =>
    api.get<{ recipes: Recipe[] }>('/cookbook/recipes', { params: status ? { status } : {} }).then(r => r.data.recipes),
  getRecipe: (id: string) => api.get<Recipe>(`/cookbook/recipes/${id}`).then(r => r.data),
  submitRecipe: (data: Partial<Recipe>) => api.post<Recipe>('/cookbook/recipes', data).then(r => r.data),
  approveRecipe: (id: string) => api.post(`/cookbook/recipes/${id}/approve`).then(r => r.data),
  deleteRecipe: (id: string) => api.delete(`/cookbook/recipes/${id}`).then(r => r.data),
  updateRecipe: (id: string, data: Partial<Recipe>) => api.patch<Recipe>(`/cookbook/recipes/${id}`, data).then(r => r.data),
  generateRecipe: (prompt: string, tagHints: string[]) =>
    api.post<RecipePreview>('/cookbook/recipes/generate', { prompt, tag_hints: tagHints }).then(r => r.data),
  extractFromPhoto: (imageBase64: string, mediaType: string) =>
    api.post<RecipePreview>('/cookbook/recipes/extract-photo', { image_base64: imageBase64, media_type: mediaType }).then(r => r.data),
  getPersonalizedDescription: (id: string) =>
    api.get<{ description: string; generated_at: string }>(`/cookbook/recipes/${id}/description`).then(r => r.data),
  getHistory: () => api.get<RecipeHistoryEntry[]>('/cookbook/history').then(r => r.data),
  reactToRecipe: (recipeId: string, reaction: 'loved' | 'okay' | 'disliked') =>
    api.post(`/cookbook/history/${recipeId}/react`, { reaction }).then(r => r.data),
};
