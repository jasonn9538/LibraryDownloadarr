import React from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { useMobileMenu } from '../hooks/useMobileMenu';

export const Help: React.FC = () => {
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();

  return (
    <div className="min-h-screen flex flex-col">
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6">Help & Guide</h2>

            <div className="space-y-6">
              {/* Getting Started */}
              <section className="card p-4 md:p-6">
                <h3 className="text-xl font-semibold mb-3 text-primary-400">Getting Started</h3>
                <div className="space-y-3 text-gray-300">
                  <p>
                    Welcome to LibraryDownloadarr! This app lets you download media from your Plex library
                    to your device for offline viewing.
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-gray-400">
                    <li>Browse your libraries using the sidebar on the left</li>
                    <li>Click on any movie, show, or album to see details</li>
                    <li>Click the download button to start downloading</li>
                  </ol>
                </div>
              </section>

              {/* Downloading */}
              <section className="card p-4 md:p-6">
                <h3 className="text-xl font-semibold mb-3 text-primary-400">Downloading Content</h3>
                <div className="space-y-3 text-gray-300">
                  <h4 className="font-medium text-white">Choosing a Resolution</h4>
                  <p className="text-gray-400">
                    When you click the download button, you'll see a list of available resolutions:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-400 ml-2">
                    <li><span className="text-green-400">Original</span> - The full quality file from your library</li>
                    <li><span className="text-blue-400">720p</span> - Best for mobile devices (smaller file size)</li>
                    <li><span className="text-gray-300">1080p, 480p</span> - Other quality options</li>
                  </ul>

                  <h4 className="font-medium text-white mt-4">Transcoding</h4>
                  <p className="text-gray-400">
                    If you choose a resolution other than the original, the file will be transcoded (converted)
                    to that resolution. This may take some time depending on the file size.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-400 ml-2">
                    <li><span className="text-yellow-400">Queued</span> - Waiting in the transcoding queue</li>
                    <li><span className="text-blue-400">Transcoding</span> - Currently being processed</li>
                    <li><span className="text-green-400">Ready to download</span> - Finished and ready!</li>
                  </ul>
                  <p className="text-gray-400 mt-2">
                    Transcoded files are cached for 1 week, so if you or someone else already transcoded
                    a file, you can download it immediately.
                  </p>
                </div>
              </section>

              {/* Playing Downloaded Files */}
              <section className="card p-4 md:p-6">
                <h3 className="text-xl font-semibold mb-3 text-primary-400">Playing Downloaded Files</h3>
                <div className="space-y-3 text-gray-300">
                  <p>
                    Once your files are downloaded, you can play them using any media player.
                    We recommend using <strong className="text-white">VLC Media Player</strong>:
                  </p>
                  <div className="bg-dark-200 rounded-lg p-4 mt-3">
                    <h4 className="font-medium text-white mb-2">VLC Media Player</h4>
                    <p className="text-gray-400 text-sm mb-2">
                      VLC is a free, open-source media player that can play virtually any video format.
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-gray-400 text-sm">
                      <li>Download from: <a href="https://www.videolan.org/vlc/" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">videolan.org/vlc</a></li>
                      <li>Available for Windows, Mac, Linux, iOS, and Android</li>
                      <li>Supports subtitles, audio tracks, and chapters</li>
                    </ul>
                  </div>
                  <p className="text-gray-400 text-sm mt-3">
                    On mobile devices, you can also use the Files app to locate your downloaded files
                    and open them with any installed video player.
                  </p>
                </div>
              </section>

              {/* Transcodes Page */}
              <section className="card p-4 md:p-6">
                <h3 className="text-xl font-semibold mb-3 text-primary-400">Managing Transcodes</h3>
                <div className="space-y-3 text-gray-300">
                  <p className="text-gray-400">
                    The <strong className="text-white">Transcodes</strong> page shows all your active and completed
                    transcoding jobs:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-400 ml-2">
                    <li>View progress of ongoing transcodes</li>
                    <li>Download completed transcodes</li>
                    <li>Cancel pending or active jobs</li>
                    <li>Toggle "Show all users" to see transcodes from other users</li>
                  </ul>
                  <p className="text-gray-400 mt-2">
                    If a transcode from another user is already complete, you can download it directly
                    without waiting for a new transcode.
                  </p>
                </div>
              </section>

              {/* Tips */}
              <section className="card p-4 md:p-6">
                <h3 className="text-xl font-semibold mb-3 text-primary-400">Tips</h3>
                <ul className="list-disc list-inside space-y-2 text-gray-400">
                  <li>
                    <strong className="text-gray-300">For mobile:</strong> 720p provides a good balance
                    of quality and file size
                  </li>
                  <li>
                    <strong className="text-gray-300">Large files:</strong> Original 4K files can be
                    very large (10GB+). Consider using a lower resolution for mobile devices
                  </li>
                  <li>
                    <strong className="text-gray-300">Slow connection?</strong> Start your transcodes
                    ahead of time and download when ready
                  </li>
                  <li>
                    <strong className="text-gray-300">Install as app:</strong> On mobile, you can add
                    this site to your home screen for a better experience
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
