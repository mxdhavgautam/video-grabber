# Video Grabber - Simplified Architecture

A YouTube video grabber using YouTubeI.js for bot-detection resistance.

## Architecture

- **Frontend**: React + Vite (built into `dist/`)
- **Backend**: Node.js with YouTubeI.js
- **Deployment**: Single Docker container serving both

## Local Development

```bash
# Install dependencies
npm install

# Run development server (backend + frontend)
npm run dev

# Build frontend
npm run build

# Run production server
npm start
```

## Docker Deployment

```bash
# Build and run
docker compose -f docker-compose.simple.yml up --build -d

# View logs
docker compose -f docker-compose.simple.yml logs -f

# Stop
docker compose -f docker-compose.simple.yml down
```

## Endpoints

- **Frontend**: `http://localhost:3001/grabber`
- **API Health**: `http://localhost:3001/api/health`
- **API Extract**: `http://localhost:3001/api/extract?url=VIDEO_URL`

## Production Deployment

### Subdomain Setup

1. **Frontend**: `mxdhavgautam.com/grabber`
2. **Backend API**: `grabberapi.mxdhavgautam.com`

### Nginx Configuration

```nginx
# API subdomain
server {
    listen 80;
    server_name grabberapi.mxdhavgautam.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}

# Frontend on main domain
server {
    listen 80;
    server_name mxdhavgautam.com;
    
    # Your Flutter portfolio at /
    location / {
        # Your existing Vercel setup
    }
    
    # Video grabber at /grabber
    location /grabber {
        proxy_pass http://localhost:3001/grabber;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Variables

Create `.env` file:

```env
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://mxdhavgautam.com,https://grabberapi.mxdhavgautam.com
```

## Why YouTubeI.js?

- Uses YouTube's official InnerTube API
- More resistant to bot detection than yt-dlp
- No need for Chrome/Puppeteer/cookies
- Works without authentication

## Previous Approach Issues

The previous approach using yt-dlp + Chrome + Puppeteer + cookies failed because:

1. **YouTube's aggressive bot detection** - Even with stealth techniques, YouTube blocks automated access
2. **Cookie generation failed** - Chrome in Docker couldn't get cookies from YouTube
3. **LOGIN_REQUIRED errors** - YouTube requires authenticated session, which is impossible to automate safely
4. **Complexity** - Too many moving parts (Chrome, Xvfb, Puppeteer, cookie exporters)

YouTubeI.js solves these issues by using YouTube's internal API directly, which is more stable and bot-resistant.
