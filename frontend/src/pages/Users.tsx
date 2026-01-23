import React, { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { api, UserInfo } from '../services/api';

export const Users: React.FC = () => {
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      setUsers(data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleToggleAdmin = async (user: UserInfo) => {
    setUpdatingUser(user.id);
    try {
      await api.updateUserAdmin(user.id, !user.isAdmin);
      await loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update user');
    } finally {
      setUpdatingUser(null);
    }
  };

  const handleDeleteUser = async (user: UserInfo) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
      return;
    }

    setUpdatingUser(user.id);
    try {
      await api.deleteUser(user.id);
      await loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete user');
    } finally {
      setUpdatingUser(null);
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatLastLogin = (timestamp?: number): string => {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}d ago`;

    return formatDate(timestamp);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">User Management</h2>
            <p className="text-gray-400 mb-6">
              Manage users who can access the application. Toggle admin privileges or remove users.
            </p>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="text-center text-gray-400 py-8">Loading users...</div>
            ) : (
              <div className="space-y-3">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="bg-dark-100 border border-dark-50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-white">{user.username}</h3>
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          user.type === 'admin'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {user.type === 'admin' ? 'Local' : 'Plex'}
                        </span>
                        {user.isAdmin && (
                          <span className="px-2 py-0.5 text-xs bg-primary-500/20 text-primary-400 rounded">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">
                        {user.email && <span>{user.email}</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex gap-4">
                        <span>Joined: {formatDate(user.createdAt)}</span>
                        <span>Last login: {formatLastLogin(user.lastLogin)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggleAdmin(user)}
                        disabled={updatingUser === user.id}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                          user.isAdmin
                            ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                            : 'bg-dark-200 text-gray-400 hover:bg-dark-50 hover:text-white'
                        } disabled:opacity-50`}
                      >
                        {updatingUser === user.id ? '...' : user.isAdmin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user)}
                        disabled={updatingUser === user.id}
                        className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete user"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

                {users.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-4xl mb-4">👥</div>
                    <p className="text-lg">No users found</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
