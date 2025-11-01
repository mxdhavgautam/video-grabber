# Video Grabber VPS Deployment Instructions

## Overview

This folder contains everything needed to deploy the Video Grabber backend to your VPS. These files should remain private and not be committed to git.

## Prerequisites

- VPS with Ubuntu 24.04 (or compatible Linux)
- Docker and Docker Compose installed
- Node.js runtime or Bun
- 8GB RAM minimum
- 150GB storage minimum

## Files in This Folder

- `Dockerfile` - Multi-stage Docker build configuration
- `docker-compose.yml` - Service orchestration configuration
- `build-and-deploy.sh` - Automated deployment script
- `.env.example` - Environment variables template

## Deployment Steps

### 1. Prepare Your VPS

```bash
# SSH into your VPS
ssh deploy@your-vps-ip

# Navigate to project directory
cd ~/projects/video-grabber

# Copy deployment files from backup
cp -r deployment-backup/* .
```

### 2. Configure Environment

```bash
# Edit configuration
cp deployment-backup/.env.example .env.docker

# Update with your actual values:
# - ALLOWED_ORIGINS: Your frontend domains
# - CHROME_PROFILE_DIR: Path for Chrome profiles
```

### 3. Deploy

```bash
# Make deployment script executable
chmod +x build-and-deploy.sh

# Run deployment
./build-and-deploy.sh
```

### 4. Verify Deployment

```bash
# Check if container is running
docker-compose ps

# View logs
docker-compose logs -f

# Test API
curl http://localhost:3001/health

# Test extraction
curl http://localhost:3001/extract?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## What This Deployment Includes

- **Xvfb**: Virtual X display for Chrome browser
- **Chromium**: Full browser instance (not headless)
- **FFmpeg**: Video processing tool
- **yt-dlp**: YouTube downloader
- **Dbus**: System service communication
- **Node.js/Bun**: Runtime environment
- **Docker**: Containerization

## Auto-Cleanup Features

- Chrome profiles rotated daily (24-hour rotation)
- Temporary files cleaned every 30 minutes
- Old Chrome profiles deleted on rotation
- Logs limited to 100MB per file, 3 files max

## Monitoring

### View Real-time Logs
```bash
docker-compose logs -f backend
```

### Check Resource Usage
```bash
docker stats video-grabber-backend
```

### Check Disk Space
```bash
df -h
du -sh /tmp/
```

## Maintenance

### Restart Container
```bash
docker-compose restart backend
```

### Stop Container
```bash
docker-compose down
```

### Update Code
```bash
git pull origin main
docker-compose build --no-cache backend
docker-compose up -d backend
```

### Clean Up Docker
```bash
docker system prune -a
```

## Troubleshooting

### Container won't start
```bash
docker-compose logs backend
```

### Out of disk space
```bash
docker system prune -a
du -sh ~/projects/video-grabber/chrome-profiles/
rm -rf ~/projects/video-grabber/chrome-profiles/profile-*
```

### yt-dlp not working
```bash
docker-compose exec backend yt-dlp --version
```

### Chrome profile issues
```bash
rm -rf ~/projects/video-grabber/chrome-profiles/*
docker-compose restart backend
```

## API Endpoints

### Extract Video Metadata
```
GET /extract?url=<YOUTUBE_URL>
```

Returns: Video title, duration, available formats, thumbnail

### Download Video
```
GET /download?url=<YOUTUBE_URL>&format=<FORMAT_ID>
```

Returns: Video file stream

### Health Check
```
GET /health
```

Returns: `{"status":"ok"}`

## Performance Notes

- Max 3 concurrent downloads (prevents VPS overload)
- 4GB memory limit for container
- 3.5 CPU cores limit
- 30-minute temp file cleanup
- Daily Chrome profile rotation
- 20-minute download timeout

## Security

- No sensitive data in git
- Cookies handled securely (daily rotation)
- Chrome profile isolation
- Container resource limits
- Automated cleanup processes

## Backup Strategy

These deployment files should be:
1. Kept in `deployment-backup/` folder locally
2. Never committed to git
3. Regularly backed up to external storage
4. Treated as private infrastructure configuration

## Support

For issues, check:
1. Backend logs: `docker-compose logs backend`
2. Docker health: `docker ps`
3. Network: `curl http://localhost:3001/health`
4. Disk space: `df -h`

---

**Last Updated**: October 2025
**Deployment Status**: ✅ Production Ready
