import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

type DeviceType = 'iphone' | 'android' | 'computer';

const getDeviceType = (): DeviceType => {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  return 'computer';
};

export const WelcomeModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const device = getDeviceType();

  useEffect(() => {
    if (!localStorage.getItem('welcomeModalDismissed')) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem('welcomeModalDismissed', 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="card bg-dark-100 p-6 max-w-md mx-4 rounded-xl">
        <div className="text-center mb-4">
          <span className="text-4xl">
            {device === 'iphone' ? '📱' : device === 'android' ? '📱' : '💻'}
          </span>
        </div>

        {device === 'iphone' && (
          <>
            <h3 className="text-xl font-semibold text-white mb-3 text-center">
              Quick Setup for iPhone
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>
                Make sure you're using <strong className="text-white">Safari</strong> (not Chrome)
              </li>
              <li>
                Install <strong className="text-white">VLC</strong> from the App Store
              </li>
              <li>
                Set your download location:{' '}
                <strong className="text-white">
                  Settings → Apps → Safari → Downloads → On My iPhone → VLC
                </strong>
              </li>
            </ol>
            <p className="text-primary-400 text-sm mt-3">
              This lets you download files directly into VLC for easy playback!
            </p>
          </>
        )}

        {device === 'android' && (
          <>
            <h3 className="text-xl font-semibold text-white mb-3 text-center">
              Quick Setup for Android
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>
                Use <strong className="text-white">Chrome</strong> (your default browser works great!)
              </li>
              <li>
                Install <strong className="text-white">VLC</strong> from the Play Store for playback
              </li>
              <li>
                Downloaded files appear in your <strong className="text-white">Downloads</strong>{' '}
                folder
              </li>
            </ol>
          </>
        )}

        {device === 'computer' && (
          <>
            <h3 className="text-xl font-semibold text-white mb-3 text-center">
              Downloading on Computer
            </h3>
            <p className="text-gray-300">
              Downloads work like any normal file download. For best playback, install{' '}
              <strong className="text-white">VLC</strong>:{' '}
              <a
                href="https://www.videolan.org/vlc/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:underline"
              >
                videolan.org/vlc
              </a>
            </p>
          </>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-dark-300">
          <button
            onClick={() => {
              dismiss();
              navigate('/help');
            }}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            See the full guide →
          </button>
          <button
            onClick={dismiss}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-colors"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};
