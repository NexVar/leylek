/**
 * Lightweight Zustand store for the current session user.
 * TanStack Query owns the *fetching* of /api/auth/me; this store mirrors
 * the result so components that don't need the loading state (e.g. the
 * topbar avatar) can pull it synchronously.
 */

import { create } from 'zustand';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}));
