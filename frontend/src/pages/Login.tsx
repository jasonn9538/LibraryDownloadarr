import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';

const PLEX_AUTH_KEY = 'plex_auth_pending';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlexLoading, setIsPlexLoading] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminLoginEnabled, setAdminLoginEnabled] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const { login, setUser, setToken, token, user } = useAuthStore();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll for Plex auth completion
  const startPolling = useCallback((pinId: number) => {
    setIsPlexLoading(true);
    setError('');
    let attempts = 0;
    const maxAttempts = 60;

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const response = await api.authenticatePlexPin(pinId);
        // Success — clean up and log in
        if (pollRef.current) clearInterval(pollRef.current);
        localStorage.removeItem(PLEX_AUTH_KEY);
        setUser(response.user);
        setToken(response.token);
        setIsPlexLoading(false);
        navigate('/');
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 500) {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(PLEX_AUTH_KEY);
          setError(err.response?.data?.error || 'Authentication failed. Please try again.');
          setIsPlexLoading(false);
          return;
        }
        if (attempts >= maxAttempts) {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(PLEX_AUTH_KEY);
          setError('Plex authentication timed out. Please try again.');
          setIsPlexLoading(false);
        }
        // 400 = not yet authorized, keep polling
      }
    }, 2000);
  }, [setUser, setToken, navigate]);

  // Check if admin login is enabled
  useEffect(() => {
    api.checkAdminLoginEnabled()
      .then(setAdminLoginEnabled)
      .catch(() => setAdminLoginEnabled(false));
  }, []);

  // On mount: check for pending Plex auth (user was redirected back from Plex)
  useEffect(() => {
    const pending = localStorage.getItem(PLEX_AUTH_KEY);
    if (pending) {
      try {
        const { pinId } = JSON.parse(pending);
        if (pinId) {
          startPolling(pinId);
        }
      } catch {
        localStorage.removeItem(PLEX_AUTH_KEY);
      }
    }
  }, [startPolling]);

  // Redirect to home if already logged in
  useEffect(() => {
    if (token && user) {
      navigate('/', { replace: true });
    }
  }, [token, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlexLogin = async () => {
    setError('');
    setIsPlexLoading(true);

    try {
      // Generate PIN
      const pin = await api.generatePlexPin();

      // Save PIN ID so we can resume after redirect
      localStorage.setItem(PLEX_AUTH_KEY, JSON.stringify({ pinId: pin.id }));

      // Navigate current page to Plex auth — no popup needed
      // Plex will redirect back to /login after auth, where we resume polling
      window.location.href = pin.url;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to initiate Plex login');
      setIsPlexLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary-500 to-secondary-500 bg-clip-text text-transparent mb-2">
            LibraryDownloadarr
          </h1>
          <p className="text-sm md:text-base text-gray-400">Your media library, ready to download</p>
        </div>

        <div className="card p-6 md:p-8">
          {/* Primary: Plex Login */}
          <div className="text-center mb-6">
            <h2 className="text-xl md:text-2xl font-bold mb-2">Sign In</h2>
            <p className="text-sm md:text-base text-gray-400">Use your Plex account to get started</p>
          </div>

          <button
            onClick={handlePlexLogin}
            disabled={isPlexLoading}
            className="btn-primary w-full flex items-center justify-center space-x-3 text-base md:text-lg py-4 font-semibold shadow-lg hover:shadow-xl transition-shadow"
          >
            <span className="text-2xl md:text-3xl">🎬</span>
            <span>{isPlexLoading ? 'Waiting for Plex...' : 'Sign in with Plex'}</span>
          </button>

          {isPlexLoading && (
            <div className="mt-4 p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg">
              <p className="text-xs md:text-sm text-gray-300 text-center">
                <strong>Completing authentication...</strong>
                <br />
                Please wait while we verify your Plex account.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-xs md:text-sm mt-4">
              {error}
            </div>
          )}

          {/* Secondary: Admin Login - only show if enabled */}
          {adminLoginEnabled && (
          <div className="mt-8 pt-6 border-t border-dark-50">
            {!showAdminLogin ? (
              <button
                onClick={() => setShowAdminLogin(true)}
                className="text-sm text-gray-400 hover:text-gray-300 transition-colors w-full text-center"
              >
                Administrator login
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-300">Administrator Login</h3>
                  <button
                    onClick={() => {
                      setShowAdminLogin(false);
                      setError('');
                      setUsername('');
                      setPassword('');
                    }}
                    className="text-xs text-gray-500 hover:text-gray-400"
                  >
                    Cancel
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs md:text-sm font-medium mb-1.5 text-gray-300">Username</label>
                    <input
                      type="text"
                      required
                      className="input text-sm"
                      placeholder="Admin username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-xs md:text-sm font-medium mb-1.5 text-gray-300">Password</label>
                    <input
                      type="password"
                      required
                      className="input text-sm"
                      placeholder="Admin password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  <button type="submit" disabled={isLoading} className="btn-secondary w-full text-sm py-2.5">
                    {isLoading ? 'Logging in...' : 'Sign In as Admin'}
                  </button>
                </form>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Helpful note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            {adminLoginEnabled ? (
              <>
                Most users should sign in with Plex.
                <br />
                Administrator access is only needed for system configuration.
              </>
            ) : (
              'Sign in with your Plex account to get started.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
