# LibraryDownloadarr

<p align="center">
  <img src="librarydownloadarr.png" alt="LibraryDownloadarr Banner" width="600"/>
</p>

> Your Plex library, ready to download

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)

## Overview

LibraryDownloadarr is a modern, self-hosted web application that provides a beautiful interface for downloading media from your Plex Media Server. Built with a sleek dark theme reminiscent of the *arr ecosystem (Sonarr, Radarr, Overseerr), it offers a user-friendly way to browse your Plex libraries and download original media files with a single click.

**Key Features:**
- 🎬 **Plex OAuth Integration** - Users sign in with their existing Plex accounts
- 🔒 **Secure & Permission-Aware** - Respects Plex's user access controls and library restrictions
- 📱 **Progressive Web App** - Installable on mobile devices with a native-like experience
- 🎨 **Modern Interface** - Beautiful, responsive design that works on all devices
- 🔍 **Smart Search** - Search across all accessible libraries with relevance-based results
- 📊 **Admin Dashboard** - Download history, logs, user management, and settings
- 🚀 **Easy Setup** - Initial setup wizard with guided configuration
- 🎥 **Resolution Selection** - Choose download quality or transcode to lower resolutions
- ⚙️ **Transcode Queue** - Queue transcodes and download when ready (files kept for 7 days after last download)
- 🖥️ **Hardware Encoding** - GPU-accelerated transcoding (Intel QSV, AMD/Intel VAAPI)
- 📦 **Bulk Downloads** - Download entire seasons or albums as ZIP files
- 👥 **User Management** - Admin can manage users and grant admin privileges
- 📁 **Direct File Access** - Optional path mappings for faster transcoding
- ❓ **Built-in Help** - Guide for users on how to use the app and play downloaded files

---

## Why You Need LibraryDownloadarr

### Common Use Cases

**For Plex Server Owners:**
- **Traveling Users**: Give your users an easy way to download media for offline viewing on flights, road trips, or areas with poor connectivity
- **Backup & Migration**: Provide a simple interface for users to retrieve their content when migrating devices
- **Media Sharing**: Allow authorized users to download content you've shared with them from your server
- **Family & Friends**: Make it easy for less technical users to grab media without needing SSH, FTP, or direct file system access

**For End Users:**
- **Offline Viewing**: Download movies and shows to watch without an internet connection
- **Device Transfers**: Move media to devices that don't have Plex apps (e.g., car entertainment systems, older tablets)
- **Data Management**: Download media to free up Plex server storage while keeping personal backups
- **No Plex Sync Required**: Direct downloads without needing Plex Pass or configuring Plex Sync

### Why Not Just Use Plex?

While Plex is excellent for streaming, it has limitations for downloading:
- **Plex Sync** requires Plex Pass (paid subscription)
- **Mobile Downloads** only work within the Plex app and can't be easily transferred
- **No Bulk Downloads** - downloading multiple items is cumbersome
- **Complex for Non-Technical Users** - accessing media files directly requires server access

LibraryDownloadarr solves these problems with a simple, web-based interface that works everywhere.

---

## Installation Methods

### Prerequisites

Before installing, ensure you have:
- ✅ **Docker** installed on your system ([Get Docker](https://docs.docker.com/get-docker/))
- ✅ **Plex Media Server** running and accessible
- ✅ **Plex Account** with access to your server

### Method 1: Docker Compose (Recommended)

This is the easiest method for most users. Create a `docker-compose.yml` file:

```yaml
services:
  librarydownloadarr:
    image: ghcr.io/jasonn9538/librarydownloadarr:latest
    container_name: librarydownloadarr
    restart: unless-stopped
    ports:
      - "5069:5069"
    environment:
      # Server configuration
      - PORT=5069
      - LOG_LEVEL=info
      - DATABASE_PATH=/app/data/librarydownloadarr.db
      - TZ=America/New_York  # Change to your timezone

      # Security settings (recommended for production)
      # - CORS_ORIGIN=https://library.yourdomain.com  # Set to your domain
      # - ADMIN_LOGIN_ENABLED=false  # Disable after promoting a Plex user to admin

      # Transcoding configuration
      - TRANSCODE_DIR=/app/transcode
      - MAX_CONCURRENT_TRANSCODES=2
      - HARDWARE_ENCODING=auto  # auto, vaapi, qsv, or software
    volumes:
      - ./data:/app/data           # Database and application data
      - ./logs:/app/logs           # Application logs
      - ./transcode:/app/transcode # Transcoded files (use fast storage)
      # Optional: Mount media for direct file access (faster transcoding)
      # - /path/to/your/media:/mnt/media:ro
    # GPU access for hardware encoding (Intel/AMD)
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "44"    # video group
      - "993"   # render group (may vary by system)
    networks:
      - librarydownloadarr

networks:
  librarydownloadarr:
    driver: bridge
```

**Start the application:**

```bash
docker-compose up -d
```

**Access the application at:** `http://localhost:5069`

### Method 2: Docker Run

If you prefer using `docker run` directly:

```bash
docker run -d \
  --name librarydownloadarr \
  --restart unless-stopped \
  -p 5069:5069 \
  -e PORT=5069 \
  -e LOG_LEVEL=info \
  -e DATABASE_PATH=/app/data/librarydownloadarr.db \
  -e TZ=America/New_York \
  -e TRANSCODE_DIR=/app/transcode \
  -e MAX_CONCURRENT_TRANSCODES=2 \
  -e HARDWARE_ENCODING=auto \
  --device /dev/dri:/dev/dri \
  --group-add 44 \
  --group-add 993 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/transcode:/app/transcode \
  ghcr.io/jasonn9538/librarydownloadarr:latest
```

### Method 3: Build from Source

If you want to build the image yourself:

```bash
# Clone the repository
git clone https://github.com/jasonn9538/LibraryDownloadarr.git
cd LibraryDownloadarr

# Build and start with Docker Compose
docker-compose up -d --build
```

### Configuration Options

Customize your deployment with environment variables:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `PORT` | Application port | `5069` | `3000` |
| `LOG_LEVEL` | Logging verbosity | `info` | `debug`, `warn`, `error` |
| `DATABASE_PATH` | SQLite database location | `/app/data/librarydownloadarr.db` | `/data/db.sqlite` |
| `TZ` | Timezone for logs and dates | `America/New_York` | `Europe/London`, `Asia/Tokyo` |
| `TRANSCODE_DIR` | Directory for transcoded files | `/app/transcode` | `/mnt/fast-storage/transcode` |
| `MAX_CONCURRENT_TRANSCODES` | Max simultaneous transcodes | `2` | `1`, `4` |
| `HARDWARE_ENCODING` | GPU encoding mode | `auto` | `vaapi`, `qsv`, `software` |
| `CORS_ORIGIN` | Allowed CORS origin | (same-origin) | `https://library.example.com` |
| `ADMIN_LOGIN_ENABLED` | Enable admin password login | `true` | `false` (Plex OAuth only) |

### Initial Setup

1. **Navigate to your LibraryDownloadarr instance** (e.g., `http://localhost:5069`)

2. **Create Admin Account** (First-time only):
   - Choose a username and secure password (12+ characters with uppercase, lowercase, and numbers)
   - This account has full administrative access

3. **Configure Plex Connection** (Settings page):
   - **Plex Server URL**: Your Plex server address (e.g., `http://192.168.1.100:32400`)
   - **Plex Token**: Your Plex authentication token ([How to find your token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/))
   - Click **Test Connection** to verify
   - Server details (Machine ID and Name) are fetched automatically

4. **Optional: Configure Path Mappings** (Settings page):
   - If you mount your media directories into the container, configure path mappings
   - This allows direct file access during transcoding (much faster than downloading via Plex API)
   - Example: Plex path `/media/Movies` → Container path `/mnt/media/Movies`

5. **Start Using**:
   - Admin can log in with username/password
   - Users sign in with their Plex accounts via OAuth

6. **Recommended: Secure for Production**:
   - Log in with your Plex account (via OAuth)
   - Go to **Users** page and promote your Plex user to admin
   - Set `ADMIN_LOGIN_ENABLED=false` in docker-compose to disable password login
   - This way, only Plex OAuth is available (more secure, supports 2FA)

### Reverse Proxy Setup (Production)

For production deployments, use a reverse proxy with HTTPS:

#### Nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name downloads.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:5069;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Traefik Example (docker-compose.yml)

```yaml
services:
  librarydownloadarr:
    image: ghcr.io/jasonn9538/librarydownloadarr:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.librarydownloadarr.rule=Host(`downloads.yourdomain.com`)"
      - "traefik.http.routers.librarydownloadarr.entrypoints=websecure"
      - "traefik.http.routers.librarydownloadarr.tls.certresolver=letsencrypt"
      - "traefik.http.services.librarydownloadarr.loadbalancer.server.port=5069"
```

---

## How It Works

### Authentication Flow

LibraryDownloadarr uses a dual authentication system:

1. **Admin Authentication**:
   - One-time setup creates a local admin account
   - Admin can configure Plex connection settings
   - Access to admin features (settings, logs, all download history)

2. **Plex OAuth Authentication** (Recommended for users):
   - Users click "Sign in with Plex"
   - Redirected to Plex.tv for authorization
   - LibraryDownloadarr verifies user has access to your configured Plex server
   - User's Plex permissions are automatically enforced

### Security Model

**Server Lock**: LibraryDownloadarr stores your Plex server's Machine ID during setup. When users authenticate:
- The app verifies they have access to YOUR specific Plex server
- Users without access to your server are denied
- This prevents random Plex users from accessing your server through your LibraryDownloadarr instance

**Permission Inheritance**: All Plex permissions are respected:
- Users only see libraries they have access to
- Downloads use the user's own Plex token
- Shared library restrictions apply

### Download Process

1. **User browses libraries** available to their Plex account
2. **Search or browse** for desired media
3. **Click download** on a movie, episode, or track
4. **Choose resolution** - original quality or transcode to a lower resolution
5. **File downloads** directly to browser (original) or queued for transcoding
6. **Download recorded** in history (visible to admins)

### Transcode Queue System

LibraryDownloadarr includes a powerful transcode queue for downloading media at different resolutions:

**How it works:**
1. **Select a resolution** when downloading video content (e.g., 720p, 480p)
2. **Non-original resolutions** are queued for transcoding using ffmpeg
3. **Navigate to the Transcodes page** to monitor progress
4. **Download when ready** - completed files are kept for 7 days after the last download
5. **Queue is shared** - if another user already transcoded the same file at the same resolution, you can download it immediately

**Features:**
- 📊 **Real-time progress** - Watch transcoding progress in the UI
- ⏱️ **Smart retention** - Files are kept for 7 days after each download (popular files stay longer)
- 👥 **Shared transcodes** - See and download transcodes from other users
- 🔄 **Queue management** - Cancel pending or in-progress transcodes
- 📱 **H.264 output** - Maximum compatibility with all devices (Main profile, Level 4.0)

**Transcode Settings:**
- Video: H.264 (hardware accelerated when available, falls back to libx264)
- Audio: AAC, 128kbps stereo
- Container: MP4 with faststart for web streaming
- Max 2 concurrent transcodes by default (configurable)

**Hardware Encoding:**
- **Auto-detection**: Set `HARDWARE_ENCODING=auto` to automatically detect available GPU
- **Intel VAAPI**: Works with Intel integrated graphics (recommended for most users)
- **Intel QSV**: Quick Sync Video for newer Intel CPUs
- **AMD VAAPI**: Works with AMD GPUs
- **Software fallback**: If no GPU is available, uses CPU encoding (slower)

To enable hardware encoding, ensure `/dev/dri` is passed to the container and the correct group IDs are added (see docker-compose example).

### Data Storage

- **Database**: SQLite database stores users, sessions, settings, and download history
- **Logs**: Application logs written to `logs/` directory
- **No Media Storage**: LibraryDownloadarr doesn't store media files—it streams them directly from your Plex server

### System Requirements

**Minimal (downloads only):**
- CPU: 1 core
- RAM: 512 MB
- Storage: 100 MB (plus space for logs and database)
- Network: Access to Plex server

**Recommended (with transcoding):**
- CPU: 4+ cores (transcoding is CPU-intensive)
- RAM: 2 GB
- Storage: 50+ GB for transcode cache (files kept for 7 days after last download)
- Network: Good bandwidth between LibraryDownloadarr and Plex server
- Fast storage (SSD) for transcode directory improves performance

**Note:** ffmpeg is included in the Docker image. No additional installation required.

---

## How to Contribute

We welcome contributions from the community! Here's how you can help:

### Reporting Issues

Found a bug or have a feature request?

1. **Check existing issues** to avoid duplicates
2. **Open a new issue** with:
   - Clear description of the problem/feature
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - Environment details (Docker version, browser, etc.)

### Contributing Code

1. **Fork the repository**
   ```bash
   git fork https://github.com/jasonn9538/LibraryDownloadarr.git
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Update documentation as needed

4. **Test your changes**
   ```bash
   # Backend tests
   cd backend
   npm test

   # Frontend tests
   cd frontend
   npm test

   # Build test
   docker-compose build
   ```

5. **Commit with clear messages**
   ```bash
   git commit -m "Add feature: descriptive message"
   ```

6. **Push and create Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

### Development Setup

For local development:

```bash
# Clone repository
git clone https://github.com/jasonn9538/LibraryDownloadarr.git
cd LibraryDownloadarr

# Backend (runs on port 5069)
cd backend
npm install
npm run dev

# Frontend (runs on port 5173)
cd frontend
npm install
npm run dev
```

---

## Troubleshooting

### Cannot connect to Plex server

**Symptoms**: "Failed to connect" errors in settings or when browsing

**Solutions**:
1. Verify Plex server URL is correct and accessible from the LibraryDownloadarr container
2. Check Plex token is valid ([Generate new token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/))
3. Use the **Test Connection** button in Settings
4. Check firewall rules between LibraryDownloadarr and Plex server
5. For Docker: Ensure network connectivity (`docker network inspect`)

### Plex OAuth login fails

**Symptoms**: "Access denied" or "No access to server" errors

**Solutions**:
1. Ensure Plex server Machine ID is correctly configured in Settings
2. Verify user has been granted access to your Plex server
3. Check that user's Plex account is active and not suspended
4. Try logging in directly to Plex web interface to verify account status

### Downloads not starting

**Symptoms**: Download button doesn't work or fails immediately

**Solutions**:
1. Check browser console for JavaScript errors (F12 → Console tab)
2. Verify user has proper Plex library permissions
3. Check file exists and is accessible in Plex
4. Review logs: `docker logs librarydownloadarr`
5. Ensure browser allows popups and downloads

### Port already in use

**Symptoms**: Container fails to start with port binding error

**Solutions**:
1. Change port mapping in docker-compose.yml: `"8080:5069"` (use 8080 or another free port)
2. Find process using port: `lsof -i :5069` or `netstat -tulpn | grep 5069`
3. Stop conflicting service or choose different port

### Container won't start

**Symptoms**: Container exits immediately or won't start

**Solutions**:
1. Check logs: `docker logs librarydownloadarr`
2. Verify volume paths exist and have correct permissions
3. Ensure Docker has enough resources (RAM, CPU)
4. Try pulling latest image: `docker-compose pull`
5. Clean rebuild: `docker-compose down && docker-compose up -d --build`

### Transcode stuck at 0% or not progressing

**Symptoms**: Transcode job shows 0% and never updates

**Solutions**:
1. Check container logs for ffmpeg errors: `docker logs librarydownloadarr | grep -i ffmpeg`
2. Verify the transcode directory is writable: `docker exec librarydownloadarr ls -la /app/transcode`
3. Ensure enough disk space for transcoded files
4. Check if ffmpeg is running: `docker exec librarydownloadarr ps aux | grep ffmpeg`
5. For large files, transcoding can take time - check CPU usage to confirm it's working

### Transcode files not appearing / download fails

**Symptoms**: Completed transcode can't be downloaded

**Solutions**:
1. Verify transcode directory is properly mounted in docker-compose.yml
2. Check file permissions on the transcode volume
3. Ensure the transcode hasn't expired (files are deleted 7 days after last download)
4. Check logs for any error messages during transcode completion

---

## Security Considerations

**Production Deployment Checklist:**
- ✅ Use HTTPS via reverse proxy (nginx, Traefik, Caddy)
- ✅ Set strong admin password during initial setup (12+ chars with complexity)
- ✅ Promote a Plex user to admin and disable password login (`ADMIN_LOGIN_ENABLED=false`)
- ✅ Configure proper Plex server URL (not public if on local network)
- ✅ Keep Plex token secure (never commit to version control)
- ✅ Regularly update to latest Docker image
- ✅ Monitor logs for suspicious activity
- ✅ Use network isolation (Docker networks)
- ✅ Implement rate limiting at reverse proxy level

**Built-in Security Features:**
- Session-based authentication with secure token generation (256-bit entropy)
- Machine ID validation prevents unauthorized server access
- Brute force protection with IP-based lockout (persists across restarts)
- Strong password requirements (12+ characters with complexity)
- Session invalidation on password change
- Content Security Policy (CSP) headers enabled
- Path traversal protection on file operations
- User permissions inherited from Plex
- Audit logging for security-sensitive actions (login, password changes, admin changes)
- CORS protection (configurable, defaults to same-origin only)
- Option to disable admin password login for Plex OAuth-only authentication

---

## Support & Community

- 💬 **Issues**: [GitHub Issues](https://github.com/jasonn9538/LibraryDownloadarr/issues)
- 🐛 **Bug Reports**: Use the issue template on GitHub
- 💡 **Feature Requests**: Open an issue with the "enhancement" label

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [Overseerr](https://overseerr.dev) and [Wizarr](https://wizarr.dev)
- Built with [Plex API](https://www.plexopedia.com/plex-media-server/api/)

---

<p align="center">
Made with ❤️ for the Plex community
</p>
