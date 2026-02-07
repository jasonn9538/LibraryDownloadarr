import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../services/api';

// Mock the API module
vi.mock('../../services/api', () => ({
  api: {
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    checkSetupRequired: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  // Reset store state
  useAuthStore.setState({ user: null, token: null, isLoading: false, error: null });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('useAuthStore', () => {
  describe('initial state', () => {
    it('has null user and token by default', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('setUser', () => {
    it('sets the user', () => {
      const user = { id: '1', username: 'admin', isAdmin: true };
      useAuthStore.getState().setUser(user);
      expect(useAuthStore.getState().user).toEqual(user);
    });

    it('clears the user with null', () => {
      useAuthStore.setState({ user: { id: '1', username: 'admin', isAdmin: true } });
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('setToken', () => {
    it('sets token and persists to localStorage', () => {
      useAuthStore.getState().setToken('my-token');
      expect(useAuthStore.getState().token).toBe('my-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'my-token');
    });

    it('clears token and removes from localStorage', () => {
      useAuthStore.getState().setToken(null);
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    });
  });

  describe('login', () => {
    it('calls api.login and sets user + token on success', async () => {
      const mockResponse = {
        user: { id: '1', username: 'admin', isAdmin: true },
        token: 'session-token',
      };
      mockedApi.login.mockResolvedValue(mockResponse);

      await useAuthStore.getState().login('admin', 'password');

      expect(mockedApi.login).toHaveBeenCalledWith('admin', 'password');
      expect(useAuthStore.getState().user).toEqual(mockResponse.user);
      expect(useAuthStore.getState().token).toBe('session-token');
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'session-token');
    });

    it('sets isLoading during login', async () => {
      let resolveLogin: any;
      mockedApi.login.mockReturnValue(new Promise(r => { resolveLogin = r; }));

      const loginPromise = useAuthStore.getState().login('admin', 'password');
      expect(useAuthStore.getState().isLoading).toBe(true);

      resolveLogin({ user: { id: '1', username: 'admin', isAdmin: true }, token: 'tok' });
      await loginPromise;
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('sets error on login failure and rethrows', async () => {
      const mockError = {
        response: { data: { error: 'Invalid credentials' } },
      };
      mockedApi.login.mockRejectedValue(mockError);

      await expect(useAuthStore.getState().login('admin', 'wrong')).rejects.toBeDefined();
      expect(useAuthStore.getState().error).toBe('Invalid credentials');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('uses fallback error message when response has no error field', async () => {
      mockedApi.login.mockRejectedValue(new Error('Network error'));

      await expect(useAuthStore.getState().login('admin', 'pass')).rejects.toBeDefined();
      expect(useAuthStore.getState().error).toBe('Login failed');
    });
  });

  describe('logout', () => {
    it('calls api.logout and clears state', async () => {
      useAuthStore.setState({
        user: { id: '1', username: 'admin', isAdmin: true },
        token: 'session-token',
      });
      mockedApi.logout.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(mockedApi.logout).toHaveBeenCalled();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    });

    it('clears state even if api.logout throws', async () => {
      useAuthStore.setState({
        user: { id: '1', username: 'admin', isAdmin: true },
        token: 'session-token',
      });
      mockedApi.logout.mockRejectedValue(new Error('Network error'));

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    });
  });

  describe('checkAuth', () => {
    it('fetches current user when token exists in localStorage', async () => {
      const mockUser = { id: '1', username: 'admin', isAdmin: true };
      (localStorage.getItem as any).mockReturnValue('stored-token');
      mockedApi.getCurrentUser.mockResolvedValue(mockUser);

      await useAuthStore.getState().checkAuth();

      expect(mockedApi.getCurrentUser).toHaveBeenCalled();
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().token).toBe('stored-token');
    });

    it('clears state when no token in localStorage', async () => {
      (localStorage.getItem as any).mockReturnValue(null);

      await useAuthStore.getState().checkAuth();

      expect(mockedApi.getCurrentUser).not.toHaveBeenCalled();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    });

    it('clears state when getCurrentUser fails (expired token)', async () => {
      (localStorage.getItem as any).mockReturnValue('expired-token');
      mockedApi.getCurrentUser.mockRejectedValue(new Error('401'));

      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    });
  });
});
