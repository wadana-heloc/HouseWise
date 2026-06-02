# Frontend Engineer Plan — Cookbook + Meal Planning

> Companion plans: [backend-engineer-plan.md](backend-engineer-plan.md) | [ai-engineer-plan.md](ai-engineer-plan.md)
> Master decisions: [cookbook-feature-wael-zany-pumpkin.md](cookbook-feature-wael-zany-pumpkin.md)

---

## Your Responsibility

- New Zustand stores and API service files
- New screens (cookbook flow, meal plan flow)
- Updates to existing home screens and profile screens
- Navigation registration in `_layout.tsx`

**You do NOT write backend routes or AI agents.**
Your data comes from the API endpoints the backend engineer builds.

---

## Reference Files (read these before starting)

- `store/itemStore.ts` — Zustand store pattern: optimistic updates, error handling
- `store/lowStockStore.ts` — simpler store pattern without optimistic updates
- `services/items.ts` — service file pattern: axios calls, TypeScript types
- `app/(family)/home.tsx` — `QuickAction` + `LockedAction` component pattern to reuse
- `constants/theme.ts` — color tokens (never hardcode hex values)
- `app/(tabs)/add-item.tsx` — form screen pattern with React Hook Form + Zod

---

## Phase 1 — Member Profile Enrichment

### Update `services/profile.ts`

Add two fields to the `PATCH /me/profile` payload and response type:

```typescript
export interface UserProfile {
  // ...existing fields...
  age_group?: 'kid' | 'teen' | 'adult' | 'senior';
  taste_preferences?: string;
}

export async function updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
  const res = await api.patch('/me/profile', data);
  return res.data;
}
```

### Update `app/edit-profile.tsx`

Add below the existing name/email fields:

1. **Age group picker** — row of 4 `TouchableOpacity` chips: `kid | teen | adult | senior`. Selected chip uses `bg-teal-600` background with white text. Same chip style as the category selector in `add-item.tsx`.

2. **Taste preferences input** — `TextInput`, multiline, max 500 chars, placeholder `"e.g. loves spicy food, hates broccoli, vegetarian"`.

Include both new fields in the `handleSave` payload.

### Update `app/add-member.tsx`

Same two fields added below the password field. Admin sets them when creating a family member. Both optional — skip if not filled.

---

## Phase 2 — Cookbook Foundation (no AI)

### AI agent status (for your awareness)
- ✅ `generate_recipe` agent — delivered. The backend `/cookbook/recipes/generate` endpoint calls it and returns a full `Recipe` or raises a 502 error (agent failure). Show the same error toast you show for any API error.
- ✅ `personalize_recipe_description` agent — delivered. The backend `/cookbook/recipes/{id}/description` endpoint may return `{ description: "", generated_at: string }` if the agent failed. Render the canonical recipe `description` field as fallback when the personalized description is empty.
- ✅ `extract_recipe_from_image` agent — delivered. The backend `/cookbook/recipes/extract-photo` endpoint is ready to integrate. The photo tab in `cookbook-add` should be fully enabled. Important: strip the `data:image/jpeg;base64,` prefix before sending — pass only the raw base64 string in `image_base64`. On a 502 response, show an error toast ("Couldn't read this image — try a clearer photo").

### `services/cookbook.ts`

```typescript
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

export interface RecipeHistoryEntry {
  id: string;
  recipe_id: string;
  reaction: 'loved' | 'okay' | 'disliked' | null;
  created_at: string;
}

export const cookbookService = {
  listRecipes: () => api.get<Recipe[]>('/cookbook/recipes').then(r => r.data),
  getRecipe: (id: string) => api.get<Recipe>(`/cookbook/recipes/${id}`).then(r => r.data),
  submitRecipe: (data: Partial<Recipe>) => api.post<Recipe>('/cookbook/recipes', data).then(r => r.data),
  approveRecipe: (id: string) => api.post(`/cookbook/recipes/${id}/approve`).then(r => r.data),
  deleteRecipe: (id: string) => api.delete(`/cookbook/recipes/${id}`).then(r => r.data),
  updateRecipe: (id: string, data: Partial<Recipe>) => api.patch<Recipe>(`/cookbook/recipes/${id}`, data).then(r => r.data),
  generateRecipe: (prompt: string, tagHints: string[]) =>
    api.post<Recipe>('/cookbook/recipes/generate', { prompt, tag_hints: tagHints }).then(r => r.data),
  extractFromPhoto: (imageBase64: string, mediaType: string) =>
    api.post<Partial<Recipe>>('/cookbook/recipes/extract-photo', { image_base64: imageBase64, media_type: mediaType }).then(r => r.data),
  getPersonalizedDescription: (id: string) =>
    api.get<{ description: string; generated_at: string }>(`/cookbook/recipes/${id}/description`).then(r => r.data),
  getHistory: () => api.get<RecipeHistoryEntry[]>('/cookbook/history').then(r => r.data),
  reactToRecipe: (recipeId: string, reaction: 'loved' | 'okay' | 'disliked') =>
    api.post(`/cookbook/history/${recipeId}/react`, { reaction }).then(r => r.data),
};
```

### `store/cookbookStore.ts`

```typescript
import { create } from 'zustand';
import { cookbookService, Recipe, RecipeHistoryEntry } from '../services/cookbook';

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
  approveRecipe: (id: string) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  generateRecipe: (prompt: string, tagHints?: string[]) => Promise<Recipe>;
  extractFromPhoto: (imageBase64: string, mediaType: string) => Promise<Partial<Recipe>>;
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
      const all = await cookbookService.listRecipes();
      set({
        recipes: all.filter(r => r.status === 'approved'),
        pendingRecipes: all.filter(r => r.status === 'pending'),
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
    set(s => ({ pendingRecipes: [recipe, ...s.pendingRecipes] }));
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
      const recipe = await cookbookService.generateRecipe(prompt, tagHints);
      set(s => ({ generating: false, pendingRecipes: [recipe, ...s.pendingRecipes] }));
      return recipe;
    } catch (e: any) {
      set({ generating: false, error: e.message });
      throw e;
    }
  },

  extractFromPhoto: async (imageBase64, mediaType) => {
    set({ generating: true, error: null });
    try {
      const result = await cookbookService.extractFromPhoto(imageBase64, mediaType);
      set({ generating: false });
      return result;
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
```

### New Screen: `app/cookbook.tsx`

**Layout:**
- Top bar: "Cookbook" title + "Add recipe" button (opens `cookbook-add` modal)
- **Admin only:** Pending section at top — amber card showing count + list of pending recipes; tap to approve/reject
- Search bar (client-side filter by name)
- Tag filter chips row: All / high_protein / kid_friendly / quick / vegetarian
- Recipe cards grid (2 columns): name, prep_minutes, tags
- Tap card → `router.push('/cookbook-detail?id=' + recipe.id)`

**Pending section (admin):**
```tsx
{role === 'admin' && pendingRecipes.length > 0 && (
  <View className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
    <Text className="text-[13px] font-medium text-amber-700">
      {pendingRecipes.length} recipe{pendingRecipes.length > 1 ? 's' : ''} awaiting approval
    </Text>
    {/* PendingRecipeRow per item with Approve / Delete buttons */}
  </View>
)}
```

### New Screen: `app/cookbook-detail.tsx`

**Receives:** `id` query param

**Layout:**
- Back button
- Recipe name (large)
- **Personalized description** — fetched via `getPersonalizedDescription(id)` on mount; skeleton loader while fetching
- Tags chips row
- Prep time + servings
- Ingredients list (name, quantity, unit per row)
- Instructions (numbered steps)
- **Family:** "Request for this week" button → meal plan submission flow
- **Admin:** "Edit" button + "Delete" button + "Save to cookbook" (for AI-invented plan meals)

### New Screen: `app/cookbook-add.tsx` (modal)

**Three-tab layout:** Manual | Photo | AI Generate

**Manual tab:**
- Name, description, instructions inputs
- Dynamic ingredient rows (add/remove)
- Tags multi-select chips
- Prep minutes + servings
- Submit → `cookbookStore.submitRecipe({...data, source: 'manual'})`

**Photo tab:**
- Camera / library picker (reuse `expo-image-picker` pattern from existing screens)
- On image selected → `cookbookStore.extractFromPhoto(base64, mediaType)`
- Shows generating spinner overlay (same style as report generation screen)
- Pre-fills the Manual tab with extracted data for review before submit

**AI Generate tab:**
- Prompt `TextInput` ("Describe what you want…")
- Tag hints multi-select
- "Generate" → `cookbookStore.generateRecipe(prompt, tagHints)`
- Shows generating spinner overlay
- Pre-fills the Manual tab with generated data for review before submit

---

## Phase 3 — Meal Plan Foundation

### AI agent status (for your awareness)
- ✅ `generate_weekly_plan` agent — delivered. The backend `/meal-plan/generate` endpoint calls it and returns a full `MealPlan` with 7 days or raises a 502 error. Show the same error toast as any API error.
- The agent automatically avoids repeating last week's recipes and orders meals by ingredient freshness (perishable meals first in the week). This is handled inside the agent — no extra frontend work needed.
- Days where `recipe_id` is null are invented meals. Their `suggested_ingredients` are stored in the database and used by the backend to auto-populate the shopping list on finalize. The frontend does not need to handle `suggested_ingredients` directly.

### `services/mealPlan.ts`

```typescript
import api from './api';

export interface MealRequest { description: string | null; recipe_id: string | null; }
export interface MealPlanSubmission {
  id: string; user_id: string; week_start: string;
  busy_days: number[]; meal_requests: MealRequest[]; submitted_at: string;
}
export interface MealPlanDay {
  id: string; plan_id: string; day_of_week: number;
  recipe_id: string | null; meal_name: string;
  prep_label: 'prep' | 'reheat' | 'fresh'; notes: string | null;
}
export interface MealPlan {
  id: string; household_id: string; week_start: string;
  status: 'draft' | 'finalized'; ai_summary: string | null;
  price_results: Record<string, any> | null;
  created_by: string; created_at: string; updated_at: string;
  days: MealPlanDay[];
}

export const mealPlanService = {
  upsertSubmission: (data: Pick<MealPlanSubmission, 'week_start' | 'busy_days' | 'meal_requests'>) =>
    api.post<MealPlanSubmission>('/meal-plan/submissions', data).then(r => r.data),
  getSubmissions: (weekStart: string) =>
    api.get<MealPlanSubmission[]>(`/meal-plan/submissions/${weekStart}`).then(r => r.data),
  getSubmissionCount: (weekStart: string) =>
    api.get<{ submitted: number; total: number }>(`/meal-plan/${weekStart}/count`).then(r => r.data),
  getPlan: (weekStart: string) =>
    api.get<MealPlan>(`/meal-plan/${weekStart}`).then(r => r.data),
  generatePlan: (weekStart: string) =>
    api.post<MealPlan>('/meal-plan/generate', { week_start: weekStart }).then(r => r.data),
  updateDay: (planId: string, dayId: string, data: Partial<MealPlanDay>) =>
    api.patch(`/meal-plan/${planId}/days/${dayId}`, data).then(r => r.data),
  finalizePlan: (planId: string) =>
    api.post(`/meal-plan/${planId}/finalize`).then(r => r.data),
  getPrices: (weekStart: string) =>
    api.get<{ price_results: Record<string, any> | null }>(`/meal-plan/${weekStart}/prices`).then(r => r.data),
  reactToDay: (planId: string, data: { recipe_id: string; reaction: string }) =>
    api.post(`/meal-plan/${planId}/react`, data).then(r => r.data),
};
```

### `store/mealPlanStore.ts`

Key state: `currentPlan`, `submissions`, `submissionCount`, `loading`, `generating`, `finalizing`, `pricePolling`, `error`

Key actions: `fetchPlan`, `fetchSubmissions`, `fetchSubmissionCount`, `upsertSubmission`, `generatePlan`, `updatePlanDay` (optimistic), `finalizePlan`, `pollPrices`

Price polling: poll every 10s after finalization, max 12 attempts (~2 min). When `price_results` is non-null, stop polling and update `currentPlan`.

### New Screen: `app/meal-plan.tsx` (Hub)

**Family view:**
- Week header
- Submission status card ("You've submitted ✓" or "Submit your week")
- "Submit my week" button → `router.push('/meal-plan-submit')`
- If finalized: "View this week's plan →" → `router.push('/meal-plan-view')`

**Admin view:**
- Week header + prev/next navigation
- Submission count card: "3 of 5 members submitted" (progress bar)
- Member list showing who has/hasn't submitted
- "Generate plan" button → calls `generatePlan(weekStart)` with spinner overlay
- If plan exists: status chip + "Review plan →" → `router.push('/meal-plan-review')`

### New Screen: `app/meal-plan-submit.tsx`

**Layout:**
- Week header
- **Busy days:** 7 day chips (Mon–Sun), multi-select, teal when selected
- **Meal requests:** list of added requests; "Add a request" inline form with toggle "Specific recipe" / "Something new"
- Submit → `upsertSubmission({week_start, busy_days, meal_requests})`

**Week start helper:**
```typescript
function getThisWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}
```

### New Screen: `app/meal-plan-review.tsx` (Admin)

**Layout:**
- Week header + status chip
- AI summary card (collapsible, teal background)
- Day cards (Mon → Sun) each showing: prep label chip (Prep=amber/Reheat=blue/Fresh=green), meal name, notes
- Tap day → inline bottom sheet editor: meal name, prep label, notes, optional recipe picker
- Sticky "Finalize & generate shopping list" CTA
- After finalize: "Searching best prices…" indicator → price breakdown when ready

### New Screen: `app/meal-plan-view.tsx` (Family read-only)

**Layout:**
- Week header
- 7 day cards, read-only: day name, meal name, prep label chip
- AI summary (collapsible)
- Reaction buttons per day (only for days with a `recipe_id`): 👍 / 😐 / 👎

---

## Home Screen Updates

### `app/(family)/home.tsx`

Replace the two `LockedAction` components with active `QuickAction` cards:

```tsx
// Remove:
<LockedAction label="Weekly report" sub="Admin only" />
<LockedAction label="Settings"      sub="Admin only" />

// Add:
<QuickAction
  icon="book-outline"
  label="Cookbook"
  sub="Browse recipes"
  onPress={() => router.push('/cookbook')}
/>
<QuickAction
  icon="calendar-outline"
  label="This week"
  sub="Meal plan"
  onPress={() => router.push('/meal-plan')}
/>
```

### `app/(tabs)/home.tsx`

Add two `QuickAction` cards after existing ones:

```tsx
<QuickAction
  icon="book-outline"
  label="Cookbook"
  sub="Manage recipes"
  onPress={() => router.push('/cookbook')}
/>
<QuickAction
  icon="calendar-outline"
  label="Meal Plan"
  sub="Plan the week"
  onPress={() => router.push('/meal-plan')}
/>
```

---

## Navigation Registration

### `app/_layout.tsx` — add to `<Stack>`

```tsx
<Stack.Screen name="cookbook" options={{ headerShown: false }} />
<Stack.Screen name="cookbook-detail" options={{ headerShown: false }} />
<Stack.Screen name="cookbook-add" options={{ headerShown: false, presentation: 'modal' }} />
<Stack.Screen name="meal-plan" options={{ headerShown: false }} />
<Stack.Screen name="meal-plan-submit" options={{ headerShown: false }} />
<Stack.Screen name="meal-plan-review" options={{ headerShown: false }} />
<Stack.Screen name="meal-plan-view" options={{ headerShown: false }} />
```

---

## Verification Checklist

- [ ] Family home shows "Cookbook" and "This week" quick action cards (not locked)
- [ ] `app/cookbook.tsx` loads approved recipes; admin sees pending section
- [ ] Admin approves pending recipe → moves to main list instantly (optimistic)
- [ ] `app/cookbook-detail.tsx` shows personalized description different from canonical
- [ ] Photo tab pre-fills form with extracted recipe data
- [ ] AI Generate tab shows spinner while generating; pre-fills form on done
- [ ] Submission updates the count visible to admin
- [ ] Admin generates plan → 7 day cards with Prep/Reheat/Fresh labels appear
- [ ] Admin edits a day → optimistic update visible immediately
- [ ] Admin finalizes → items appear in shopping list tab labeled "From meal plan"
- [ ] "Searching best prices…" indicator appears; disappears when prices load
- [ ] Family sees read-only plan → can react per day
- [ ] Reaction persists after navigating away and back

---

## Coordinator Note: Timing Dependencies

| You need | From backend | Phase |
|---|---|---|
| `GET /cookbook/recipes` shape | `RecipeOut` schema | Phase 2 |
| `POST /cookbook/recipes/generate` | Phase 3 | Phase 3 |
| `GET /meal-plan/{week}/count` `{submitted, total}` | Phase 4 | Phase 4 |
| `POST /meal-plan/generate` (slow AI) | Phase 5 | Phase 5 |
| `POST /meal-plan/{id}/finalize` 202 + polling | Phase 5 | Phase 5 |
