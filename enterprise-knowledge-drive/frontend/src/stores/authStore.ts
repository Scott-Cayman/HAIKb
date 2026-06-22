import { create } from 'zustand';
import api from '../services/api';

export interface User {
  id: number;
  name: string;
  avatar?: string;
  is_admin: boolean;
  is_super_admin: boolean;
  department_name?: string;
  full_department_path?: string;
  root_department_name?: string;
  is_active: boolean;
  username?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
  _checkAuthPromise: Promise<void> | null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: true,
  isAuthenticated: !!localStorage.getItem('token'),
  _checkAuthPromise: null,

  login: (token: string, user: User) => {
    localStorage.setItem('token', token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null, isAuthenticated: false, _checkAuthPromise: null });
  },

  checkAuth: async () => {
    const existingPromise = get()._checkAuthPromise;
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        set({ isLoading: false, isAuthenticated: false, _checkAuthPromise: null });
        return;
      }

      try {
        const response = await api.get('/auth/me');
        set({ user: response.data, isAuthenticated: true, isLoading: false, _checkAuthPromise: null });
      } catch (error) {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false, isLoading: false, _checkAuthPromise: null });
      }
    })();

    set({ _checkAuthPromise: promise });
    return promise;
  },
}));
