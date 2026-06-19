import { create } from 'zustand';
import {
  mealPlanService,
  MealPlan,
  MealPlanDay,
  MealPlanSubmission,
  MealPlanSubmissionStatus,
} from '../services/mealPlan';

interface MealPlanState {
  currentPlan: MealPlan | null;
  mySubmission: MealPlanSubmission | null;
  submissionStatus: MealPlanSubmissionStatus | null;
  loading: boolean;
  generating: boolean;
  finalizing: boolean;
  error: string | null;

  fetchPlan: (weekStart: string) => Promise<void>;
  fetchMySubmission: (weekStart: string) => Promise<MealPlanSubmission | null>;
  fetchSubmissionStatus: (weekStart: string) => Promise<void>;
  upsertSubmission: (data: Pick<MealPlanSubmission, 'week_start' | 'busy_days' | 'meal_requests'> & { week_notes?: string | null }) => Promise<void>;
  generatePlan: (weekStart: string) => Promise<void>;
  updatePlanDay: (planId: string, day: MealPlanDay, changes: Partial<MealPlanDay>) => Promise<void>;
  finalizePlan: (planId: string) => Promise<void>;
  reactToDay: (planId: string, dayId: string, reaction: string) => Promise<void>;
  clearPlan: () => void;
}

export const useMealPlanStore = create<MealPlanState>((set, get) => ({
  currentPlan: null,
  mySubmission: null,
  submissionStatus: null,
  loading: false,
  generating: false,
  finalizing: false,
  error: null,

  fetchPlan: async (weekStart) => {
    set({ loading: true, error: null });
    try {
      const plan = await mealPlanService.getPlan(weekStart);
      set({ currentPlan: plan, loading: false });
    } catch (e: any) {
      if (e?.response?.status === 404) {
        set({ currentPlan: null, loading: false });
      } else {
        set({ loading: false, error: e.message });
      }
    }
  },

  fetchMySubmission: async (weekStart) => {
    try {
      const sub = await mealPlanService.getMySubmission(weekStart);
      set({ mySubmission: sub });
      return sub;
    } catch (e: any) {
      if (e?.response?.status === 404) {
        set({ mySubmission: null });
      }
      return null;
    }
  },

  fetchSubmissionStatus: async (weekStart) => {
    try {
      const status = await mealPlanService.getSubmissionStatus(weekStart);
      set({ submissionStatus: status });
    } catch {
      set({ submissionStatus: null });
    }
  },

  upsertSubmission: async (data) => {
    await mealPlanService.upsertSubmission(data);
    await get().fetchMySubmission(data.week_start);
    await get().fetchSubmissionStatus(data.week_start);
  },

  generatePlan: async (weekStart) => {
    set({ generating: true, error: null });
    try {
      const plan = await mealPlanService.generatePlan(weekStart);
      set({ currentPlan: plan, generating: false });
    } catch (e: any) {
      set({ generating: false, error: e.message });
      throw e;
    }
  },

  updatePlanDay: async (planId, day, changes) => {
    // Optimistic update
    set(s => {
      if (!s.currentPlan) return s;
      return {
        currentPlan: {
          ...s.currentPlan,
          days: s.currentPlan.days.map(d =>
            d.id === day.id ? { ...d, ...changes } : d
          ),
        },
      };
    });
    try {
      const updatedPlan = await mealPlanService.updateDay(planId, day.id, changes);
      set({ currentPlan: updatedPlan });
    } catch (e: any) {
      // Rollback
      set(s => {
        if (!s.currentPlan) return s;
        return {
          currentPlan: {
            ...s.currentPlan,
            days: s.currentPlan.days.map(d => d.id === day.id ? day : d),
          },
        };
      });
      throw e;
    }
  },

  finalizePlan: async (planId) => {
    set({ finalizing: true, error: null });
    try {
      const plan = await mealPlanService.finalizePlan(planId);
      set({ currentPlan: plan, finalizing: false });
    } catch (e: any) {
      set({ finalizing: false, error: e.message });
      throw e;
    }
  },

  reactToDay: async (planId, dayId, reaction) => {
    await mealPlanService.reactToDay(planId, { day_id: dayId, reaction });
  },

  clearPlan: () => {
    set({ currentPlan: null, mySubmission: null, submissionStatus: null, error: null });
  },
}));
