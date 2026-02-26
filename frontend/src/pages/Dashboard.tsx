import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { HubRow } from '../components/HubRow';
import { api } from '../services/api';
import { Hub } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { WelcomeModal } from '../components/WelcomeModal';

export const Dashboard: React.FC = () => {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();

  useEffect(() => {
    if (!user) {
      return;
    }
    loadDashboard();
  }, [user]);

  const loadDashboard = async () => {
    try {
      const [hubData, downloadStats] = await Promise.all([
        api.getHubs(12),
        api.getDownloadStats().catch(() => null),
      ]);
      setHubs(hubData);
      setStats(downloadStats);
    } catch (error) {
      console.error('Failed to load dashboard', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen flex flex-col">
      <WelcomeModal />
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-[1800px] mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Home</h2>

            {user?.isAdmin && stats && (
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => navigate('/admin/download-history')}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-200 hover:bg-dark-300 text-sm text-gray-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>Downloads: {stats.count || 0} ({formatBytes(stats.total_size)})</span>
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-200 hover:bg-dark-300 text-sm text-gray-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>Settings</span>
                </button>
              </div>
            )}

            {isLoading ? (
              <div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <HubRow key={i} title="" items={[]} isLoading />
                ))}
              </div>
            ) : hubs.length > 0 ? (
              <div>
                {hubs.map((hub) => (
                  <HubRow
                    key={hub.hubIdentifier}
                    title={hub.title}
                    items={hub.items}
                  />
                ))}
              </div>
            ) : (
              <div className="card p-6 md:p-8 text-center">
                <p className="text-gray-400 text-sm md:text-base">
                  No content found. Make sure your Plex server is configured in Settings.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
