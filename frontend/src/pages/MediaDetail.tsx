import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { api } from '../services/api';
import { MediaItem } from '../types';
import { useDownloads } from '../contexts/DownloadContext';

export const MediaDetail: React.FC = () => {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const { startDownload, downloads } = useDownloads();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [seasons, setSeasons] = useState<MediaItem[]>([]);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<string, MediaItem[]>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ratingKey) {
      loadMediaDetails();
    }
  }, [ratingKey]);

  const loadMediaDetails = async () => {
    if (!ratingKey) return;

    setIsLoading(true);
    setError('');

    try {
      const metadata = await api.getMediaMetadata(ratingKey);
      setMedia(metadata);

      // If it's a TV show, load seasons
      if (metadata.type === 'show') {
        const seasonsData = await api.getSeasons(ratingKey);
        setSeasons(seasonsData);
      }

      // If it's a season (clicked directly from recently added), load episodes
      if (metadata.type === 'season') {
        const episodesData = await api.getEpisodes(ratingKey);
        setEpisodesBySeason({ [ratingKey]: episodesData });
        setExpandedSeasons({ [ratingKey]: true }); // Auto-expand the season
      }

      // If it's an album (audiobook), load tracks
      if (metadata.type === 'album') {
        const tracksData = await api.getTracks(ratingKey);
        setTracks(tracksData);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load media details');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSeason = async (seasonRatingKey: string) => {
    setExpandedSeasons((prev) => ({
      ...prev,
      [seasonRatingKey]: !prev[seasonRatingKey],
    }));

    // Load episodes if not already loaded
    if (!episodesBySeason[seasonRatingKey]) {
      try {
        const episodes = await api.getEpisodes(seasonRatingKey);
        setEpisodesBySeason((prev) => ({
          ...prev,
          [seasonRatingKey]: episodes,
        }));
      } catch (err) {
        console.error('Failed to load episodes:', err);
      }
    }
  };

  // Helper function to check if a download is in progress for a given part
  const isDownloading = (partKey: string): boolean => {
    return downloads.some(d => d.partKey === partKey && d.status === 'downloading');
  };

  // Helper function to get download progress for a given part
  const getDownloadProgress = (partKey: string): number => {
    const download = downloads.find(d => d.partKey === partKey);
    return download?.progress || 0;
  };

  const handleDownload = async (itemRatingKey: string, partKey: string, filename: string, itemTitle: string) => {
    // Use the global download context with the specific item's rating key
    await startDownload(itemRatingKey, partKey, filename, itemTitle);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 p-8 flex items-center justify-center">
            <div className="text-gray-400">Loading...</div>
          </main>
        </div>
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 p-8">
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">
              {error || 'Media not found'}
            </div>
          </main>
        </div>
      </div>
    );
  }

  const posterUrl = media.thumb ? api.getThumbnailUrl(media.ratingKey, media.thumb) : null;
  const backdropUrl = media.art ? api.getThumbnailUrl(media.ratingKey, media.art) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1">
          {/* Backdrop */}
          {backdropUrl && (
            <div
              className="h-96 bg-cover bg-center relative"
              style={{ backgroundImage: `url(${backdropUrl})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/60 to-transparent" />
            </div>
          )}

          <div className={`p-8 relative z-10 ${backdropUrl ? '-mt-48' : ''}`}>
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col md:flex-row gap-8">
                {/* Poster */}
                <div className="flex-shrink-0">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={media.title}
                      className="w-64 rounded-lg shadow-2xl"
                    />
                  ) : (
                    <div className="w-64 h-96 bg-dark-200 rounded-lg flex items-center justify-center">
                      <span className="text-6xl">
                        {media.type === 'movie' ? '🎬' : '📺'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1">
                  <h1 className="text-4xl font-bold mb-2">{media.title}</h1>

                  <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4">
                    {media.year && <span>{media.year}</span>}
                    {media.contentRating && <span>{media.contentRating}</span>}
                    {media.duration && <span>{formatDuration(media.duration)}</span>}
                    {media.rating && <span>⭐ {media.rating.toFixed(1)}</span>}
                  </div>

                  {media.summary && (
                    <p className="text-gray-300 mb-6 leading-relaxed">{media.summary}</p>
                  )}

                  {media.studio && (
                    <div className="mb-4">
                      <span className="text-sm text-gray-500">Studio: </span>
                      <span className="text-sm text-gray-300">{media.studio}</span>
                    </div>
                  )}

                  {/* Download Options */}
                  <div className="mt-8">
                    <h2 className="text-2xl font-semibold mb-4">Download</h2>

                    {media.type === 'album' ? (
                      // Album (Audiobook) - Show tracks
                      tracks.length > 0 ? (
                        <div className="space-y-2">
                          {tracks.map((track, index) => (
                            <div
                              key={track.ratingKey}
                              className="card p-3 flex items-center justify-between"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="text-gray-400 font-mono text-sm w-8">
                                  {index + 1}.
                                </div>
                                <div>
                                  <div className="font-medium">{track.title}</div>
                                  <div className="text-sm text-gray-400">
                                    {track.duration && formatDuration(track.duration)}
                                    {track.Media?.[0]?.Part?.[0]?.size && (
                                      <> • {formatFileSize(track.Media[0].Part[0].size)}</>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {track.Media?.[0]?.Part?.[0] && (
                                <div className="flex flex-col items-end gap-2">
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        track.ratingKey,
                                        track.Media![0].Part[0].key,
                                        track.Media![0].Part[0].file.split('/').pop() || 'download',
                                        track.title
                                      )
                                    }
                                    disabled={isDownloading(track.Media![0].Part[0].key)}
                                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isDownloading(track.Media![0].Part[0].key)
                                      ? `${getDownloadProgress(track.Media![0].Part[0].key)}%`
                                      : 'Download'}
                                  </button>
                                  {isDownloading(track.Media![0].Part[0].key) && (
                                    <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300 ease-out"
                                        style={{ width: `${getDownloadProgress(track.Media![0].Part[0].key)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400">No tracks available</div>
                      )
                    ) : media.type === 'season' && ratingKey ? (
                      // Season (clicked directly) - Show episodes
                      episodesBySeason[ratingKey] && episodesBySeason[ratingKey].length > 0 ? (
                        <div className="space-y-2">
                          {episodesBySeason[ratingKey].map((episode: MediaItem) => (
                            <div
                              key={episode.ratingKey}
                              className="card p-3 flex items-center justify-between"
                            >
                              <div className="flex items-center space-x-3">
                                {episode.thumb && (
                                  <img
                                    src={api.getThumbnailUrl(episode.ratingKey, episode.thumb)}
                                    alt={episode.title}
                                    className="w-24 h-16 object-cover rounded"
                                  />
                                )}
                                <div>
                                  <div className="font-medium">{episode.title}</div>
                                  <div className="text-sm text-gray-400">
                                    {episode.duration && formatDuration(episode.duration)}
                                    {episode.Media?.[0]?.Part?.[0]?.size && (
                                      <> • {formatFileSize(episode.Media[0].Part[0].size)}</>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {episode.Media?.[0]?.Part?.[0] && (
                                <div className="flex flex-col items-end gap-2">
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        episode.ratingKey,
                                        episode.Media![0].Part[0].key,
                                        episode.Media![0].Part[0].file.split('/').pop() || 'download',
                                        episode.title
                                      )
                                    }
                                    disabled={isDownloading(episode.Media![0].Part[0].key)}
                                    className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isDownloading(episode.Media![0].Part[0].key)
                                      ? `${getDownloadProgress(episode.Media![0].Part[0].key)}%`
                                      : 'Download'}
                                  </button>
                                  {isDownloading(episode.Media![0].Part[0].key) && (
                                    <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300 ease-out"
                                        style={{ width: `${getDownloadProgress(episode.Media![0].Part[0].key)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400">No episodes available</div>
                      )
                    ) : media.type === 'show' ? (
                      // TV Show - Show seasons and episodes
                      seasons.length > 0 ? (
                        <div className="space-y-4">
                          {seasons.map((season) => (
                            <div key={season.ratingKey} className="card">
                              <button
                                onClick={() => toggleSeason(season.ratingKey)}
                                className="w-full p-4 flex items-center justify-between hover:bg-dark-200 transition-colors"
                              >
                                <div className="flex items-center space-x-4">
                                  {season.thumb && (
                                    <img
                                      src={api.getThumbnailUrl(season.ratingKey, season.thumb)}
                                      alt={season.title}
                                      className="w-16 h-24 object-cover rounded"
                                    />
                                  )}
                                  <div className="text-left">
                                    <div className="font-medium text-lg">{season.title}</div>
                                    {season.summary && (
                                      <div className="text-sm text-gray-400 line-clamp-2">
                                        {season.summary}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-gray-400">
                                    {expandedSeasons[season.ratingKey] ? '▼' : '▶'}
                                  </span>
                                </div>
                              </button>

                              {expandedSeasons[season.ratingKey] && (
                                <div className="border-t border-dark-50 p-4 space-y-2">
                                  {episodesBySeason[season.ratingKey] ? (
                                    episodesBySeason[season.ratingKey].map((episode) => (
                                      <div
                                        key={episode.ratingKey}
                                        className="card p-3 flex items-center justify-between"
                                      >
                                        <div className="flex items-center space-x-3">
                                          {episode.thumb && (
                                            <img
                                              src={api.getThumbnailUrl(episode.ratingKey, episode.thumb)}
                                              alt={episode.title}
                                              className="w-24 h-16 object-cover rounded"
                                            />
                                          )}
                                          <div>
                                            <div className="font-medium">{episode.title}</div>
                                            <div className="text-sm text-gray-400">
                                              {episode.duration && formatDuration(episode.duration)}
                                              {episode.Media?.[0]?.Part?.[0]?.size && (
                                                <> • {formatFileSize(episode.Media[0].Part[0].size)}</>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                        {episode.Media?.[0]?.Part?.[0] && (
                                          <div className="flex flex-col items-end gap-2">
                                            <button
                                              onClick={() =>
                                                handleDownload(
                                                  episode.ratingKey,
                                                  episode.Media![0].Part[0].key,
                                                  episode.Media![0].Part[0].file.split('/').pop() || 'download',
                                                  episode.title
                                                )
                                              }
                                              disabled={isDownloading(episode.Media![0].Part[0].key)}
                                              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                              {isDownloading(episode.Media![0].Part[0].key)
                                                ? `${getDownloadProgress(episode.Media![0].Part[0].key)}%`
                                                : 'Download'}
                                            </button>
                                            {isDownloading(episode.Media![0].Part[0].key) && (
                                              <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                                                <div
                                                  className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300 ease-out"
                                                  style={{ width: `${getDownloadProgress(episode.Media![0].Part[0].key)}%` }}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-center text-gray-400 py-4">Loading episodes...</div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400">No seasons available</div>
                      )
                    ) : (
                      // Movie or other media type - Show direct download
                      media.Media && media.Media.length > 0 ? (
                        <div className="space-y-4">
                          {media.Media.map((mediaPart, idx) => (
                            <div key={idx} className="card p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium mb-1">
                                    {mediaPart.videoResolution} - {mediaPart.videoCodec.toUpperCase()}
                                  </div>
                                  <div className="text-sm text-gray-400">
                                    {mediaPart.width}x{mediaPart.height} • {mediaPart.container.toUpperCase()}
                                    {mediaPart.Part[0]?.size && (
                                      <> • {formatFileSize(mediaPart.Part[0].size)}</>
                                    )}
                                  </div>
                                </div>
                                {mediaPart.Part.map((part, partIdx) => (
                                  <div key={partIdx} className="flex flex-col items-end gap-2">
                                    <button
                                      onClick={() =>
                                        handleDownload(
                                          ratingKey!,
                                          part.key,
                                          part.file.split('/').pop() || 'download',
                                          media.title
                                        )
                                      }
                                      disabled={isDownloading(part.key)}
                                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {isDownloading(part.key)
                                        ? `${getDownloadProgress(part.key)}%`
                                        : 'Download'}
                                    </button>
                                    {isDownloading(part.key) && (
                                      <div className="w-32 h-2 bg-dark-200 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300 ease-out"
                                          style={{ width: `${getDownloadProgress(part.key)}%` }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400">No download options available</div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
