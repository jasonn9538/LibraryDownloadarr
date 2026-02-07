/**
 * Mock Plex API response data for tests.
 */

export const MOCK_PIN = { id: 12345, code: 'ABCD1234' };

export const MOCK_AUTH_RESPONSE = {
  authToken: 'mock-plex-auth-token',
  user: {
    id: 999,
    uuid: 'plex-uuid-999',
    email: 'plexuser@plex.tv',
    username: 'PlexTestUser',
    title: 'PlexTestUser',
    thumb: 'https://plex.tv/users/999/avatar',
  },
};

export const MOCK_LIBRARIES = [
  { key: '1', title: 'Movies', type: 'movie' },
  { key: '2', title: 'TV Shows', type: 'show' },
  { key: '3', title: 'Music', type: 'artist' },
];

export const MOCK_LIBRARY_CONTENT = {
  items: [
    { ratingKey: '100', title: 'Test Movie', type: 'movie', addedAt: 1700000000 },
    { ratingKey: '101', title: 'Another Movie', type: 'movie', addedAt: 1700001000 },
  ],
  totalSize: 50,
};

export const MOCK_METADATA_MOVIE = {
  ratingKey: '100',
  title: 'Test Movie',
  type: 'movie',
  year: 2024,
  summary: 'A test movie',
  librarySectionTitle: 'Movies',
  librarySectionID: '1',
  allowSync: true,
  Media: [{
    id: 1,
    duration: 7200000,
    bitrate: 8000,
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    videoCodec: 'h264',
    videoResolution: '1080',
    container: 'mkv',
    videoFrameRate: '24p',
    Part: [{
      id: 1,
      key: '/library/parts/1/file.mkv',
      duration: 7200000,
      file: '/media/movies/Test Movie (2024)/Test.Movie.2024.mkv',
      size: 7200000000,
      container: 'mkv',
    }],
  }],
};

export const MOCK_METADATA_EPISODE = {
  ratingKey: '200',
  title: 'Pilot',
  type: 'episode',
  grandparentTitle: 'Test Show',
  parentTitle: 'Season 1',
  index: 1,
  parentIndex: 1,
  allowSync: true,
  librarySectionTitle: 'TV Shows',
  Media: [{
    id: 2,
    duration: 3600000,
    bitrate: 6000,
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    videoCodec: 'h264',
    videoResolution: '1080',
    container: 'mkv',
    videoFrameRate: '24p',
    Part: [{
      id: 2,
      key: '/library/parts/2/file.mkv',
      duration: 3600000,
      file: '/media/tv/Test Show/Season 01/S01E01.mkv',
      size: 3600000000,
      container: 'mkv',
    }],
  }],
};

export const MOCK_SEASONS = [
  { ratingKey: '300', title: 'Season 1', type: 'season', index: 1, parentRatingKey: '250' },
  { ratingKey: '301', title: 'Season 2', type: 'season', index: 2, parentRatingKey: '250' },
];

export const MOCK_EPISODES = [
  MOCK_METADATA_EPISODE,
  { ...MOCK_METADATA_EPISODE, ratingKey: '201', title: 'Episode 2', index: 2 },
];

export const MOCK_TRACKS = [
  {
    ratingKey: '400', title: 'Track 1', type: 'track', index: 1,
    parentTitle: 'Test Album', allowSync: true,
    Media: [{ id: 3, Part: [{ id: 3, key: '/library/parts/3/file.flac', file: '/music/track1.flac', size: 50000000, container: 'flac' }] }],
  },
  {
    ratingKey: '401', title: 'Track 2', type: 'track', index: 2,
    parentTitle: 'Test Album', allowSync: true,
    Media: [{ id: 4, Part: [{ id: 4, key: '/library/parts/4/file.flac', file: '/music/track2.flac', size: 60000000, container: 'flac' }] }],
  },
];

export const MOCK_SEARCH_RESULTS = [
  { ratingKey: '100', title: 'Test Movie', type: 'movie', year: 2024 },
  { ratingKey: '250', title: 'Test Show', type: 'show', year: 2023 },
];

export const MOCK_SERVER_IDENTITY = {
  machineIdentifier: 'test-machine-id-123',
  friendlyName: 'Test Plex Server',
};

export const MOCK_USER_SERVERS = [
  {
    name: 'Test Plex Server',
    provides: 'server',
    owned: '0',
    clientIdentifier: 'test-machine-id-123',
    accessToken: 'shared-access-token',
    Connection: [{ uri: 'http://192.168.1.100:32400', local: '1', protocol: 'http' }],
  },
];
