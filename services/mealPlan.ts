import api from './api';

export interface MealRequest {
  description: string | null;
  recipe_id: string | null;
}

export interface MealPlanSubmission {
  id: string;
  user_id: string;
  week_start: string;
  busy_days: number[];
  meal_requests: MealRequest[];
  week_notes: string | null;
  submitted_at: string;
}

export interface SubmissionMember {
  user_id: string;
  display_name: string;
  submitted: boolean;
}

export interface MealPlanSubmissionStatus {
  week_start: string;
  submitted: number;
  total: number;
  members: SubmissionMember[];
}

export interface SuggestedIngredient {
  name: string;
  quantity: string;
  unit: string;
  category: string;
}

export interface MealPlanDay {
  id: string;
  plan_id: string;
  day_of_week: number;
  recipe_id: string | null;
  meal_name: string;
  prep_label: 'prep' | 'reheat' | 'fresh';
  notes: string | null;
  suggested_ingredients: SuggestedIngredient[];
}

export interface MealPlan {
  id: string;
  household_id: string;
  week_start: string;
  status: 'draft' | 'finalized';
  ai_summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  days: MealPlanDay[];
}

export interface DayReaction {
  id: string;
  day_id: string;
  user_id: string;
  reaction: 'liked' | 'disliked';
  created_at: string;
  updated_at: string;
}

export const mealPlanService = {
  upsertSubmission: (data: Pick<MealPlanSubmission, 'week_start' | 'busy_days' | 'meal_requests'> & { week_notes?: string | null }) =>
    api.post<MealPlanSubmission>('/meal-plan/submissions', data).then(r => r.data),

  getMySubmission: (weekStart: string) =>
    api.get<MealPlanSubmission>('/meal-plan/submissions/me', { params: { week_start: weekStart } }).then(r => r.data),

  getSubmissionStatus: (weekStart: string) =>
    api.get<MealPlanSubmissionStatus>('/meal-plan/submissions/status', { params: { week_start: weekStart } }).then(r => r.data),

  getPlan: (weekStart: string) =>
    api.get<MealPlan>(`/meal-plan/${weekStart}`).then(r => r.data),

  generatePlan: (weekStart: string) =>
    api.post<MealPlan>('/meal-plan/generate', { week_start: weekStart }).then(r => r.data),

  updateDay: (planId: string, dayId: string, data: Partial<MealPlanDay>) =>
    api.patch<MealPlan>(`/meal-plan/${planId}/days/${dayId}`, data).then(r => r.data),

  // Deferred — no UI yet
  finalizePlan: (planId: string) =>
    api.post<MealPlan>(`/meal-plan/${planId}/finalize`).then(r => r.data),
  reactToDay: (planId: string, data: { day_id: string; reaction: string }) =>
    api.post(`/meal-plan/${planId}/react`, data).then(r => r.data),
  getReactions: (planId: string) =>
    api.get<{ plan_id: string; reactions: DayReaction[] }>(`/meal-plan/${planId}/reactions`).then(r => r.data),
};
