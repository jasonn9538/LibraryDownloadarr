import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { api } from '../services/api';
import { MediaItem } from '../types';
import { useDownloads } from '../contexts/DownloadContext';
import { useMobileMenu } from '../hooks/useMobileMenu';
import { ResolutionSelector, ResolutionOption } from '../components/ResolutionSelector';

export const MediaDetail: React.FC = () => {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();
  const { startDownload } = useDownloads();
  const { isMobileMenuOpen, toggleMobileMenu, closeMobileMenu } = useMobileMenu();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [seasons, setSeasons] = useState<MediaItem[]>([]);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<string, MediaItem[]>>({});
  const [expandedSeasons, setExpandedSeasons] = useState<Record<string, boolean>>({});
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [transcodeQueued, setTranscodeQueued] = useState<string | null>(null);

  // State for resolution selector
  const [resolutionSelectorOpen, setResolutionSelectorOpen] = useState<string | null>(null);
  const downloadButtonRefs = useRef<{ [key: string]: React.RefObject<HTMLButtonElement> }>({});

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

  // Helper to get or create a ref for a download button
  const getButtonRef = (key: string): React.RefObject<HTMLButtonElement> => {
    if (!downloadButtonRefs.current[key]) {
      downloadButtonRefs.current[key] = React.createRef<HTMLButtonElement>();
    }
    return downloadButtonRefs.current[key];
  };

  // Check if media has video (for quality selection)
  const isVideoMedia = (mediaItem: MediaItem | null): boolean => {
    if (!mediaItem) return false;
    return mediaItem.type === 'movie' || mediaItem.type === 'episode';
  };

  // Open resolution selector for video content
  const openResolutionSelector = (itemKey: string) => {
    setResolutionSelectorOpen(itemKey);
  };

  // Handle resolution selection
  const handleResolutionSelect = async (
    resolution: ResolutionOption,
    itemRatingKey: string,
    partKey: string,
    filename: string,
    itemTitle: string,
    fileSize?: number
  ) => {
    setResolutionSelectorOpen(null);

    // For non-original resolutions, queue for transcoding instead of downloading directly
    if (!resolution.isOriginal) {
      try {
        await api.queueTranscode(itemRatingKey, resolution.id);
        setTranscodeQueued(itemTitle);
        // Auto-hide the notification after 5 seconds
        setTimeout(() => setTranscodeQueued(null), 5000);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to queue transcode');
      }
      return;
    }

    // Original resolution - download directly
    // Check file size and warn if over 10GB
    if (fileSize) {
      const tenGB = 10737418240;
      if (fileSize > tenGB) {
        const sizeGB = (fileSize / 1073741824).toFixed(2);
        const confirmed = window.confirm(
          `This file is ${sizeGB} GB. Large downloads may take a long time and use significant bandwidth.\n\nDo you want to continue?`
        );
        if (!confirmed) {
          return;
        }
      }
    }

    // Use the global download context for original resolution
    await startDownload(itemRatingKey, partKey, filename, itemTitle, {
      resolutionId: resolution.id,
      resolutionLabel: resolution.label,
      isOriginal: true,
    });
  };

  const handleDownload = async (itemRatingKey: string, partKey: string, filename: string, itemTitle: string, fileSize?: number) => {
    // Check file size and warn if over 10GB
    const tenGB = 10737418240;
    if (fileSize && fileSize > tenGB) {
      const sizeGB = (fileSize / 1073741824).toFixed(2);
      const confirmed = window.confirm(
        `This file is ${sizeGB} GB. Large downloads may take a long time and use significant bandwidth.\n\nDo you want to continue?`
      );
      if (!confirmed) {
        return;
      }
    }

    // Use the global download context with the specific item's rating key
    await startDownload(itemRatingKey, partKey, filename, itemTitle);
  };

  const handleSeasonDownload = async (seasonRatingKey: string, seasonTitle: string) => {
    try {
      // Get size info first
      const sizeInfo = await api.getSeasonSize(seasonRatingKey);

      // Check if over 10GB and confirm
      const tenGB = 10737418240;
      if (sizeInfo.totalSize > tenGB) {
        const confirmed = window.confirm(
          `This season contains ${sizeInfo.fileCount} episodes totaling ${sizeInfo.totalSizeGB} GB.\n\nLarge downloads may take a long time and use significant bandwidth.\n\nDo you want to continue?`
        );
        if (!confirmed) {
          return;
        }
      }

      const downloadUrl = api.getSeasonDownloadUrl(seasonRatingKey);
      const showName = media?.title || 'Unknown Show';
      const seasonNumber = seasons.find(s => s.ratingKey === seasonRatingKey)?.index || 0;
      const zipFilename = `${showName} - S${String(seasonNumber).padStart(2, '0')}.zip`;

      // Use the download context to track the season download
      await startDownload(seasonRatingKey, downloadUrl, zipFilename, `${seasonTitle} (Full Season)`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start season download');
    }
  };

  const handleAlbumDownload = async (albumRatingKey: string, albumTitle: string) => {
    try {
      // Get size info first
      const sizeInfo = await api.getAlbumSize(albumRatingKey);

      // Check if over 10GB and confirm
      const tenGB = 10737418240;
      if (sizeInfo.totalSize > tenGB) {
        const confirmed = window.confirm(
          `This album contains ${sizeInfo.fileCount} tracks totaling ${sizeInfo.totalSizeGB} GB.\n\nLarge downloads may take a long time and use significant bandwidth.\n\nDo you want to continue?`
        );
        if (!confirmed) {
          return;
        }
      }

      const downloadUrl = api.getAlbumDownloadUrl(albumRatingKey);
      const zipFilename = `${albumTitle}.zip`;

      // Use the download context to track the album download
      await startDownload(albumRatingKey, downloadUrl, zipFilename, `${albumTitle} (Full Album)`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start album download');
    }
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

  if (error || !media) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onMenuClick={toggleMobileMenu} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
          <main className="flex-1 p-4 md:p-8 overflow-y-auto">
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
      <Header onMenuClick={toggleMobileMenu} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />
        <main className="flex-1 overflow-y-auto">
          {/* Transcode queued notification */}
          {transcodeQueued && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-blue-500/90 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in">
              <span>⚙️</span>
              <div>
                <div className="font-medium">Transcode queued</div>
                <div className="text-sm text-blue-100">{transcodeQueued}</div>
              </div>
              <button
                onClick={() => navigate('/transcodes')}
                className="ml-4 px-3 py-1 bg-white/20 rounded hover:bg-white/30 transition-colors text-sm"
              >
                View Queue
              </button>
              <button
                onClick={() => setTranscodeQueued(null)}
                className="ml-2 text-white/70 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* Backdrop */}
          {backdropUrl && (
            <div
              className="h-48 md:h-96 bg-cover bg-center relative"
              style={{ backgroundImage: `url(${backdropUrl})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/60 to-transparent" />
            </div>
          )}

          <div className={`p-4 md:p-8 relative z-10 ${backdropUrl ? '-mt-24 md:-mt-48' : ''}`}>
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col md:flex-row gap-4 md:gap-8">
                {/* Poster */}
                <div className="flex-shrink-0">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={media.title}
                      className="w-full max-w-[200px] md:w-64 rounded-lg shadow-2xl"
                    />
                  ) : (
                    <div className="w-full max-w-[200px] md:w-64 h-72 md:h-96 bg-dark-200 rounded-lg flex items-center justify-center">
                      <span className="text-4xl md:text-6xl">
                        {media.type === 'movie' ? '🎬' : '📺'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1">
                  <h1 className="text-2xl md:text-4xl font-bold mb-2">{media.title}</h1>

                  <div className="flex flex-wrap gap-2 md:gap-4 text-xs md:text-sm text-gray-400 mb-4">
                    {media.year && <span>{media.year}</span>}
                    {media.contentRating && <span>{media.contentRating}</span>}
                    {media.duration && <span>{formatDuration(media.duration)}</span>}
                    {media.rating && <span>⭐ {media.rating.toFixed(1)}</span>}
                  </div>

                  {media.summary && (
                    <p className="text-sm md:text-base text-gray-300 mb-4 md:mb-6 leading-relaxed">{media.summary}</p>
                  )}

                  {media.studio && (
                    <div className="mb-4">
                      <span className="text-xs md:text-sm text-gray-500">Studio: </span>
                      <span className="text-xs md:text-sm text-gray-300">{media.studio}</span>
                    </div>
                  )}

                  {/* Download Options */}
                  <div className="mt-4 md:mt-8">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl md:text-2xl font-semibold">Download</h2>
                      {media.type === 'album' && tracks.length > 0 && (
                        <button
                          onClick={() => handleAlbumDownload(ratingKey!, media.title)}
                          className="btn-primary"
                          title="Download entire album as ZIP"
                        >
                          📦 Download Album
                        </button>
                      )}
                    </div>

                    {media.type === 'album' ? (
                      // Album (Audiobook) - Show tracks
                      tracks.length > 0 ? (
                        <div className="space-y-2">
                          {tracks.map((track, index) => (
                            <div
                              key={track.ratingKey}
                              className="card p-3 md:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="text-gray-400 font-mono text-sm w-6 md:w-8">
                                  {index + 1}.
                                </div>
                                <div>
                                  <div className="font-medium text-sm md:text-base">{track.title}</div>
                                  <div className="text-xs md:text-sm text-gray-400">
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
                                        track.title,
                                        track.Media![0].Part[0].size
                                      )
                                    }
                                    className="btn-primary"
                                  >
                                    Download
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400">No tracks available</div>
                      )
                    ) : media.type === 'season' && ratingKey ? (
                      // Season (clicked directly) - Show episodes with quality selection
                      episodesBySeason[ratingKey] && episodesBySeason[ratingKey].length > 0 ? (
                        <div className="space-y-2">
                          {episodesBySeason[ratingKey].map((episode: MediaItem) => {
                            const buttonKey = `season-ep-${episode.ratingKey}`;
                            const buttonRef = getButtonRef(buttonKey);
                            return (
                              <div
                                key={episode.ratingKey}
                                className="card p-3 md:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0"
                              >
                                <div className="flex items-center space-x-3">
                                  {episode.thumb && (
                                    <img
                                      src={api.getThumbnailUrl(episode.ratingKey, episode.thumb)}
                                      alt={episode.title}
                                      className="w-20 h-12 md:w-24 md:h-16 object-cover rounded"
                                    />
                                  )}
                                  <div>
                                    <div className="font-medium text-sm md:text-base">{episode.title}</div>
                                    <div className="text-xs md:text-sm text-gray-400">
                                      {episode.duration && formatDuration(episode.duration)}
                                      {episode.Media?.[0]?.Part?.[0]?.size && (
                                        <> • {formatFileSize(episode.Media[0].Part[0].size)}</>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {episode.Media?.[0]?.Part?.[0] && (
                                  <div className="flex flex-col items-end gap-2 relative">
                                    <button
                                      ref={buttonRef}
                                      onClick={() => openResolutionSelector(buttonKey)}
                                      className="btn-primary flex items-center gap-1"
                                    >
                                      Download
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    {resolutionSelectorOpen === buttonKey && (
                                      <ResolutionSelector
                                        ratingKey={episode.ratingKey}
                                        isOpen={true}
                                        buttonRef={buttonRef}
                                        onCancel={() => setResolutionSelectorOpen(null)}
                                        onSelect={(quality) =>
                                          handleResolutionSelect(
                                            quality,
                                            episode.ratingKey,
                                            episode.Media![0].Part[0].key,
                                            episode.Media![0].Part[0].file.split('/').pop() || 'download',
                                            episode.title,
                                            episode.Media![0].Part[0].size
                                          )
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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
                              <div className="p-3 md:p-4 flex items-center justify-between">
                                <button
                                  onClick={() => toggleSeason(season.ratingKey)}
                                  className="flex-1 flex items-center space-x-3 md:space-x-4 hover:bg-dark-200 transition-colors rounded -m-3 md:-m-4 p-3 md:p-4"
                                >
                                  {season.thumb && (
                                    <img
                                      src={api.getThumbnailUrl(season.ratingKey, season.thumb)}
                                      alt={season.title}
                                      className="w-12 h-18 md:w-16 md:h-24 object-cover rounded"
                                    />
                                  )}
                                  <div className="text-left flex-1">
                                    <div className="font-medium text-base md:text-lg">{season.title}</div>
                                    {season.summary && (
                                      <div className="text-xs md:text-sm text-gray-400 line-clamp-2">
                                        {season.summary}
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-gray-400">
                                    {expandedSeasons[season.ratingKey] ? '▼' : '▶'}
                                  </span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSeasonDownload(season.ratingKey, season.title);
                                  }}
                                  className="btn-primary ml-2 whitespace-nowrap text-sm md:text-base px-3 md:px-4 py-2"
                                  title="Download entire season as ZIP"
                                >
                                  📦 Season
                                </button>
                              </div>

                              {expandedSeasons[season.ratingKey] && (
                                <div className="border-t border-dark-50 p-3 md:p-4 space-y-2">
                                  {episodesBySeason[season.ratingKey] ? (
                                    episodesBySeason[season.ratingKey].map((episode) => {
                                      const buttonKey = `show-ep-${episode.ratingKey}`;
                                      const buttonRef = getButtonRef(buttonKey);
                                      return (
                                        <div
                                          key={episode.ratingKey}
                                          className="card p-3 md:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0"
                                        >
                                          <div className="flex items-center space-x-3">
                                            {episode.thumb && (
                                              <img
                                                src={api.getThumbnailUrl(episode.ratingKey, episode.thumb)}
                                                alt={episode.title}
                                                className="w-20 h-12 md:w-24 md:h-16 object-cover rounded"
                                              />
                                            )}
                                            <div>
                                              <div className="font-medium text-sm md:text-base">{episode.title}</div>
                                              <div className="text-xs md:text-sm text-gray-400">
                                                {episode.duration && formatDuration(episode.duration)}
                                                {episode.Media?.[0]?.Part?.[0]?.size && (
                                                  <> • {formatFileSize(episode.Media[0].Part[0].size)}</>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                          {episode.Media?.[0]?.Part?.[0] && (
                                            <div className="flex flex-col items-end gap-2 relative">
                                              <button
                                                ref={buttonRef}
                                                onClick={() => openResolutionSelector(buttonKey)}
                                                className="btn-primary flex items-center gap-1"
                                              >
                                                Download
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                              </button>
                                              {resolutionSelectorOpen === buttonKey && (
                                                <ResolutionSelector
                                                  ratingKey={episode.ratingKey}
                                                  isOpen={true}
                                                  buttonRef={buttonRef}
                                                  onCancel={() => setResolutionSelectorOpen(null)}
                                                  onSelect={(quality) =>
                                                    handleResolutionSelect(
                                                      quality,
                                                      episode.ratingKey,
                                                      episode.Media![0].Part[0].key,
                                                      episode.Media![0].Part[0].file.split('/').pop() || 'download',
                                                      episode.title,
                                                      episode.Media![0].Part[0].size
                                                    )
                                                  }
                                                />
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })
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
                      // Movie or other media type - Show direct download with quality selection
                      media.Media && media.Media.length > 0 ? (
                        <div className="space-y-4">
                          {media.Media.map((mediaPart, idx) => (
                            <div key={idx} className="card p-4 md:p-6">
                              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0">
                                <div>
                                  <div className="font-medium text-sm md:text-base mb-1">
                                    {mediaPart.videoResolution} - {mediaPart.videoCodec.toUpperCase()}
                                  </div>
                                  <div className="text-xs md:text-sm text-gray-400">
                                    {mediaPart.width}x{mediaPart.height} • {mediaPart.container.toUpperCase()}
                                    {mediaPart.Part[0]?.size && (
                                      <> • {formatFileSize(mediaPart.Part[0].size)}</>
                                    )}
                                  </div>
                                </div>
                                {mediaPart.Part.map((part, partIdx) => {
                                  const buttonKey = `movie-${idx}-${partIdx}`;
                                  const buttonRef = getButtonRef(buttonKey);
                                  return (
                                    <div key={partIdx} className="flex flex-col items-end gap-2 relative">
                                      <button
                                        ref={buttonRef}
                                        onClick={() => {
                                          // For video content, show quality selector
                                          if (isVideoMedia(media)) {
                                            openResolutionSelector(buttonKey);
                                          } else {
                                            // For non-video, direct download
                                            handleDownload(
                                              ratingKey!,
                                              part.key,
                                              part.file.split('/').pop() || 'download',
                                              media.title,
                                              part.size
                                            );
                                          }
                                        }}
                                        className="btn-primary flex items-center gap-1"
                                      >
                                        Download
                                        {isVideoMedia(media) && (
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        )}
                                      </button>
                                      {resolutionSelectorOpen === buttonKey && (
                                        <ResolutionSelector
                                          ratingKey={ratingKey!}
                                          isOpen={true}
                                          buttonRef={buttonRef}
                                          onCancel={() => setResolutionSelectorOpen(null)}
                                          onSelect={(quality) =>
                                            handleResolutionSelect(
                                              quality,
                                              ratingKey!,
                                              part.key,
                                              part.file.split('/').pop() || 'download',
                                              media.title,
                                              part.size
                                            )
                                          }
                                        />
                                      )}
                                    </div>
                                  );
                                })}
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
