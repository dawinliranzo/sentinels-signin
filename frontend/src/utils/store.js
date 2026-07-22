import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set, get) => ({
      // Auth
      token: null,
      user: null,
      organization: null,
      setAuth: (token, user, organization) => set({ token, user, organization }),
      updateUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null, organization: null }),

      // Kiosk mode
      isKiosk: false,
      setKiosk: (val) => set({ isKiosk: val }),

      // Active visits (real-time)
      activeVisits: [],
      setActiveVisits: (visits) => set({ activeVisits: visits }),

      // Notifications
      toast: null,
      showToast: (message, type = 'info') => set({ toast: { message, type } }),
      clearToast: () => set({ toast: null }),
    }),
    { name: 'sentinels-signin-storage' }
  )
);
