import React, { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { api } from '../services/api';
import { Settings as SettingsType, PathMapping, WorkerInfo } from '../types';
import { useMobileMenu } from '../hooks/useMobileMenu';

export const Settings: React.FC = () => {
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const [settings, setSettings] = useState<SettingsType>({
    plexUrl: '',
    hasPlexToken: false,
  });
  const [plexUrl, setPlexUrl] = useState('');
  const [plexToken, setPlexToken] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Path mappings state
  const [pathMappings, setPathMappings] = useState<PathMapping[]>([]);
  const [isSavingMappings, setIsSavingMappings] = useState(false);
  const [mappingsMessage, setMappingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Transcoding state
  const [maxConcurrentTranscodes, setMaxConcurrentTranscodes] = useState(2);
  const [isSavingTranscoding, setIsSavingTranscoding] = useState(false);
  const [transcodingMessage, setTranscodingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Workers state
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [hasWorkerKey, setHasWorkerKey] = useState(false);
  const [workerKey, setWorkerKey] = useState<string | null>(null);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [workerMessage, setWorkerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadWorkers = useCallback(async () => {
    try {
      const data = await api.getWorkers();
      setWorkers(data.workers);
      setHasWorkerKey(data.hasWorkerKey);
    } catch {
      // Workers endpoint may not be accessible for non-admin users
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadWorkers();
  }, [loadWorkers]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
      setPlexUrl(data.plexUrl);
      setPathMappings(data.pathMappings || []);
      setMaxConcurrentTranscodes(data.maxConcurrentTranscodes ?? 2);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const updateData: any = {};
      if (plexUrl) {
        updateData.plexUrl = plexUrl;
      }
      if (plexToken) {
        updateData.plexToken = plexToken;
      }

      await api.updateSettings(updateData);

      setMessage({ type: 'success', text: 'Settings saved successfully' });
      await loadSettings();
      setPlexToken('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setMessage(null);

    try {
      // Use values from input boxes if provided, otherwise use saved settings
      const urlToTest = plexUrl || settings.plexUrl;
      const tokenToTest = plexToken || (settings.hasPlexToken ? 'saved' : '');

      if (!urlToTest) {
        setMessage({ type: 'error', text: 'Please enter a Plex server URL' });
        setIsTesting(false);
        return;
      }

      if (!tokenToTest && !settings.hasPlexToken) {
        setMessage({ type: 'error', text: 'Please enter a Plex token' });
        setIsTesting(false);
        return;
      }

      const connected = await api.testPlexConnection(
        plexUrl || undefined,
        plexToken || undefined
      );
      if (connected) {
        setMessage({ type: 'success', text: 'Successfully connected to Plex server' });
      } else {
        setMessage({ type: 'error', text: 'Failed to connect to Plex server' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to test connection' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChangingPassword(true);
    setPasswordMessage(null);

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'All fields are required' });
      setIsChangingPassword(false);
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'New password must be at least 6 characters long' });
      setIsChangingPassword(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' });
      setIsChangingPassword(false);
      return;
    }

    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordMessage({ type: 'success', text: 'Password changed successfully' });

      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordMessage({
        type: 'error',
        text: err.response?.data?.error || 'Failed to change password'
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleAddMapping = () => {
    setPathMappings([...pathMappings, { plexPath: '', localPath: '' }]);
  };

  const handleRemoveMapping = (index: number) => {
    setPathMappings(pathMappings.filter((_, i) => i !== index));
  };

  const handleMappingChange = (index: number, field: 'plexPath' | 'localPath', value: string) => {
    const updated = [...pathMappings];
    updated[index][field] = value;
    setPathMappings(updated);
  };

  const handleSaveMappings = async () => {
    setIsSavingMappings(true);
    setMappingsMessage(null);

    try {
      // Filter out empty mappings
      const validMappings = pathMappings.filter(m => m.plexPath.trim() && m.localPath.trim());
      await api.updateSettings({ pathMappings: validMappings } as any);
      setPathMappings(validMappings);
      setMappingsMessage({ type: 'success', text: 'Path mappings saved successfully' });
    } catch (err: any) {
      setMappingsMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save path mappings' });
    } finally {
      setIsSavingMappings(false);
    }
  };

  const handleSaveTranscoding = async () => {
    if (maxConcurrentTranscodes < 1 || maxConcurrentTranscodes > 10) {
      setTranscodingMessage({ type: 'error', text: 'Must be between 1 and 10' });
      return;
    }
    setIsSavingTranscoding(true);
    setTranscodingMessage(null);

    try {
      await api.updateSettings({ maxConcurrentTranscodes } as any);
      setTranscodingMessage({ type: 'success', text: 'Transcoding settings saved successfully' });
    } catch (err: any) {
      setTranscodingMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save transcoding settings' });
    } finally {
      setIsSavingTranscoding(false);
    }
  };

  const handleGenerateWorkerKey = async () => {
    if (hasWorkerKey && !confirm('This will invalidate the existing worker API key. All connected workers will need to be reconfigured. Continue?')) {
      return;
    }
    setIsGeneratingKey(true);
    setWorkerMessage(null);
    try {
      const key = await api.generateWorkerKey();
      setWorkerKey(key);
      setHasWorkerKey(true);
      setWorkerMessage({ type: 'success', text: 'Worker API key generated. Copy it now — it won\'t be shown again.' });
    } catch (err: any) {
      setWorkerMessage({ type: 'error', text: err.response?.data?.error || 'Failed to generate key' });
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleRemoveWorker = async (workerId: string, workerName: string) => {
    if (!confirm(`Remove worker "${workerName}"?`)) return;
    try {
      await api.deleteWorker(workerId);
      setWorkerMessage({ type: 'success', text: `Worker "${workerName}" removed` });
      loadWorkers();
    } catch (err: any) {
      setWorkerMessage({ type: 'error', text: err.response?.data?.error || 'Failed to remove worker' });
    }
  };

  const formatTimeAgo = (timestamp?: number): string => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onMenuClick={toggleMobileMenu} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
          <main className="flex-1 p-4 md:p-8 overflow-y-auto flex items-center justify-center">
            <div className="text-gray-400">Loading...</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-3xl">
            <h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Settings</h1>

            <div className="card p-4 md:p-6">
              <form onSubmit={handleSave} className="space-y-4 md:space-y-6">
                <div>
                  <h2 className="text-xl md:text-2xl font-semibold mb-4">Plex Server Configuration</h2>

                  <div className="space-y-3 md:space-y-4">
                    <div>
                      <label className="block text-sm md:text-base font-medium mb-2">Plex Server URL</label>
                      <input
                        type="text"
                        className="input text-sm md:text-base"
                        placeholder="http://127.0.0.1:32400"
                        value={plexUrl}
                        onChange={(e) => setPlexUrl(e.target.value)}
                      />
                      <p className="text-xs md:text-sm text-gray-500 mt-1">
                        The URL of your Plex Media Server. For local Docker containers, use:
                        <br />
                        • <code className="text-gray-400">http://127.0.0.1:32400</code> or <code className="text-gray-400">http://localhost:32400</code>
                        <br />
                        • <code className="text-gray-400">http://host.docker.internal:32400</code> (from Docker container)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm md:text-base font-medium mb-2">Plex Token</label>
                      <input
                        type="password"
                        className="input text-sm md:text-base"
                        placeholder={
                          settings.hasPlexToken ? 'Token configured (enter new to update)' : 'Enter token'
                        }
                        value={plexToken}
                        onChange={(e) => setPlexToken(e.target.value)}
                      />
                      <p className="text-xs md:text-sm text-gray-500 mt-1">
                        Your Plex authentication token (admin token for server access)
                      </p>
                    </div>

                    {settings.plexServerName && (
                      <div>
                        <label className="block text-sm md:text-base font-medium mb-2">Configured Server</label>
                        <input
                          type="text"
                          className="input text-sm md:text-base bg-dark-200"
                          value={settings.plexServerName}
                          readOnly
                        />
                        <p className="text-xs md:text-sm text-gray-500 mt-1">
                          Server identity is automatically detected when you save your settings.
                          Users logging in via Plex OAuth will only be granted access if they have permission to this server.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {message && (
                  <div
                    className={`px-4 py-3 rounded-lg text-xs md:text-sm ${
                      message.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                  <button type="submit" disabled={isSaving} className="btn-primary text-sm md:text-base">
                    {isSaving ? 'Saving...' : 'Save Settings'}
                  </button>

                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting || !(plexUrl || settings.plexUrl)}
                    className="btn-secondary text-sm md:text-base"
                  >
                    {isTesting ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </form>
            </div>

            <div className="card p-4 md:p-6 mt-4 md:mt-6">
              <h2 className="text-xl md:text-2xl font-semibold mb-2">Path Mappings</h2>
              <p className="text-xs md:text-sm text-gray-500 mb-4">
                Map Plex media paths to local container paths for faster transcoding.
                When the container has direct access to media files, transcoding can use local files
                instead of downloading via the Plex API.
              </p>

              <div className="space-y-3">
                {pathMappings.map((mapping, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 p-3 bg-dark-200 rounded-lg">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-400 mb-1">Plex Path</label>
                      <input
                        type="text"
                        className="input text-sm"
                        placeholder="/media/Movies"
                        value={mapping.plexPath}
                        onChange={(e) => handleMappingChange(index, 'plexPath', e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-center text-gray-500 py-2 sm:py-0 sm:px-2 sm:pt-5">
                      →
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-400 mb-1">Container Path</label>
                      <input
                        type="text"
                        className="input text-sm"
                        placeholder="/mnt/media/Movies"
                        value={mapping.localPath}
                        onChange={(e) => handleMappingChange(index, 'localPath', e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMapping(index)}
                      className="text-red-400 hover:text-red-300 p-2 sm:pt-5"
                      title="Remove mapping"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {pathMappings.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No path mappings configured. Transcoding will download files via the Plex API.
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleAddMapping}
                    className="btn-secondary text-sm"
                  >
                    + Add Mapping
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMappings}
                    disabled={isSavingMappings}
                    className="btn-primary text-sm"
                  >
                    {isSavingMappings ? 'Saving...' : 'Save Mappings'}
                  </button>
                </div>

                {mappingsMessage && (
                  <div
                    className={`px-4 py-3 rounded-lg text-xs md:text-sm ${
                      mappingsMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {mappingsMessage.text}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4 md:p-6 mt-4 md:mt-6">
              <h2 className="text-xl md:text-2xl font-semibold mb-2">Local Transcoding</h2>
              <p className="text-xs md:text-sm text-gray-500 mb-4">
                Configure how many transcodes run on this server. Workers have their own limits set via the MAX_CONCURRENT environment variable.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm md:text-base font-medium mb-2">Max Concurrent Transcodes</label>
                  <input
                    type="number"
                    className="input text-sm md:text-base w-24"
                    min={1}
                    max={10}
                    value={maxConcurrentTranscodes}
                    onChange={(e) => setMaxConcurrentTranscodes(parseInt(e.target.value, 10) || 1)}
                  />
                  <p className="text-xs md:text-sm text-gray-500 mt-1">
                    Number of transcodes that can run simultaneously (1-10). Higher values use more CPU/GPU resources.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSaveTranscoding}
                  disabled={isSavingTranscoding}
                  className="btn-primary text-sm"
                >
                  {isSavingTranscoding ? 'Saving...' : 'Save Transcoding Settings'}
                </button>

                {transcodingMessage && (
                  <div
                    className={`px-4 py-3 rounded-lg text-xs md:text-sm ${
                      transcodingMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {transcodingMessage.text}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4 md:p-6 mt-4 md:mt-6">
              <h2 className="text-xl md:text-2xl font-semibold mb-2">Distributed Workers</h2>
              <p className="text-xs md:text-sm text-gray-500 mb-4">
                Offload transcoding to remote machines. Workers connect to this server and claim pending transcode jobs.
              </p>

              <div className="space-y-4">
                {/* Worker API Key */}
                <div>
                  <label className="block text-sm md:text-base font-medium mb-2">Worker API Key</label>
                  {workerKey && (
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        className="input text-sm font-mono flex-1"
                        value={workerKey}
                        readOnly
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(workerKey);
                          setWorkerMessage({ type: 'success', text: 'Key copied to clipboard' });
                        }}
                        className="btn-secondary text-sm px-3"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerateWorkerKey}
                    disabled={isGeneratingKey}
                    className="btn-primary text-sm"
                  >
                    {isGeneratingKey ? 'Generating...' : hasWorkerKey ? 'Regenerate Key' : 'Generate Key'}
                  </button>
                  <p className="text-xs text-gray-500 mt-1">
                    {hasWorkerKey
                      ? 'A worker API key is configured. Regenerating will invalidate the existing key.'
                      : 'Generate a key to allow workers to connect to this server.'}
                  </p>
                </div>

                {/* Connected Workers Table */}
                {workers.length > 0 && (
                  <div>
                    <label className="block text-sm md:text-base font-medium mb-2">Connected Workers</label>
                    <div className="space-y-2">
                      {workers.map(worker => {
                        let caps: { gpu?: string; encoders?: string[]; maxConcurrent?: number; os?: string } = {};
                        try {
                          if (worker.capabilities) caps = JSON.parse(worker.capabilities);
                        } catch { /* ignore */ }

                        return (
                          <div key={worker.id} className="flex items-center justify-between p-3 bg-dark-200 rounded-lg">
                            <div className="flex items-center gap-3">
                              <span className={`w-2.5 h-2.5 rounded-full ${worker.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`} />
                              <div>
                                <div className="text-sm font-medium text-white">{worker.name}</div>
                                <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                                  {caps.gpu && <span>GPU: {caps.gpu}</span>}
                                  {caps.encoders && caps.encoders.length > 0 && (
                                    <span>Encoders: {caps.encoders.join(', ')}</span>
                                  )}
                                  {caps.maxConcurrent && <span>Max: {caps.maxConcurrent}</span>}
                                  <span>Active: {worker.activeJobs}</span>
                                  <span>Last seen: {formatTimeAgo(worker.lastHeartbeat)}</span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveWorker(worker.id, worker.name)}
                              className="text-red-400 hover:text-red-300 text-sm px-2"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {workers.length === 0 && hasWorkerKey && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No workers connected. Deploy a worker container with the API key above.
                  </div>
                )}

                {workerMessage && (
                  <div
                    className={`px-4 py-3 rounded-lg text-xs md:text-sm ${
                      workerMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {workerMessage.text}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4 md:p-6 mt-4 md:mt-6">
              <h2 className="text-xl md:text-2xl font-semibold mb-4">Change Password</h2>
              <form onSubmit={handleChangePassword} className="space-y-3 md:space-y-4">
                <div>
                  <label className="block text-sm md:text-base font-medium mb-2">Current Password</label>
                  <input
                    type="password"
                    className="input text-sm md:text-base"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                </div>

                <div>
                  <label className="block text-sm md:text-base font-medium mb-2">New Password</label>
                  <input
                    type="password"
                    className="input text-sm md:text-base"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min. 6 characters)"
                  />
                </div>

                <div>
                  <label className="block text-sm md:text-base font-medium mb-2">Confirm New Password</label>
                  <input
                    type="password"
                    className="input text-sm md:text-base"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                </div>

                {passwordMessage && (
                  <div
                    className={`px-4 py-3 rounded-lg text-xs md:text-sm ${
                      passwordMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {passwordMessage.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="btn-primary text-sm md:text-base"
                >
                  {isChangingPassword ? 'Changing Password...' : 'Change Password'}
                </button>
              </form>
            </div>

            <div className="card p-4 md:p-6 mt-4 md:mt-6">
              <h2 className="text-xl md:text-2xl font-semibold mb-4">About</h2>
              <div className="space-y-2 text-xs md:text-sm text-gray-400">
                <p>
                  <span className="font-medium text-gray-300">LibraryDownloadarr</span> v1.0.0
                </p>
                <p>A modern web application for downloading media from your media library server</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
