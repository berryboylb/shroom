import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  isGuest: boolean | null;
  setAccessToken: (token: string) => void;
  setDisplayName: (name: string) => void;
  setSession: (session: AuthSession) => void;
  clearAuth: () => void;
}

export interface AuthSession {
  access_token: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
  is_guest: boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      displayName: null,
      email: null,
      avatarUrl: null,
      isGuest: null,
      setAccessToken: (token) => set({ accessToken: token }),
      setDisplayName: (name) => set({ displayName: name }),
      setSession: (session) => set({
        accessToken: session.access_token,
        displayName: session.display_name,
        email: session.email ?? null,
        avatarUrl: session.avatar_url ?? null,
        isGuest: session.is_guest,
      }),
      clearAuth: () => set({ accessToken: null, displayName: null, email: null, avatarUrl: null, isGuest: null }),
    }),
    {
      name: 'shroom-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: state => ({
        displayName: state.displayName,
        email: state.email,
        avatarUrl: state.avatarUrl,
        isGuest: state.isGuest,
      }),
      merge: (persisted, current) => ({
        ...current,
        displayName: (persisted as Partial<AuthState>)?.displayName ?? null,
        email: (persisted as Partial<AuthState>)?.email ?? null,
        avatarUrl: (persisted as Partial<AuthState>)?.avatarUrl ?? null,
        isGuest: (persisted as Partial<AuthState>)?.isGuest ?? null,
        accessToken: null,
      }),
    }
  )
);
