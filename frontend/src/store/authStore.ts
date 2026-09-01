import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  displayName: string | null;
  setAccessToken: (token: string) => void;
  setDisplayName: (name: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      displayName: null,
      setAccessToken: (token) => set({ accessToken: token }),
      setDisplayName: (name) => set({ displayName: name }),
      clearAuth: () => set({ accessToken: null, displayName: null }),
    }),
    {
      name: 'shroom-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: state => ({ displayName: state.displayName }),
      merge: (persisted, current) => ({
        ...current,
        displayName: (persisted as Partial<AuthState>)?.displayName ?? null,
        accessToken: null,
      }),
    }
  )
);
