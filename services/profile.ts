import api from './api';

export interface HealthPreferences {
  high_protein: boolean;
  low_calories: boolean;
  low_carbs: boolean;
  low_sugar: boolean;
  whole_grain: boolean;
}

export interface DietaryPreferences {
  dietary_types: string[];
  allergies: string[];
  dislikes: string[];
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
    household_id: string;
    health_preferences: HealthPreferences;
    dietary_preferences: DietaryPreferences;
  };
  household: { id: string; name: string; admin_id: string } | null;
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/me');
  return data;
}

export async function updateProfile(params: { display_name?: string; email?: string }): Promise<void> {
  await api.patch('/me/profile', params);
}

export async function updateHealthPreferences(prefs: Partial<HealthPreferences>): Promise<HealthPreferences> {
  const { data } = await api.patch<HealthPreferences>('/me/health-preferences', prefs);
  return data;
}

export async function updateDietaryPreferences(prefs: DietaryPreferences): Promise<DietaryPreferences> {
  const { data } = await api.patch<DietaryPreferences>('/me/dietary-preferences', prefs);
  return data;
}
