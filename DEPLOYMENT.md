# Video Grabber - Deployment Guide

## Complete Deployment Instructions

This guide will help you deploy the Video Grabber application with both frontend and backend on your VPS.

### 1. Prerequisites

- VPS with Docker and Docker Compose installed
- Domain configured (`mxdhavgautam.com` and `grabberapi.mxdhavgautam.com`)
- Nginx installed on VPS

### 2. Push Code to GitHub

```bash
# Ensure .gitignore is properly configured (already done)
git add .
git commit -m "Simplified architecture with YouTubeI.js"
git push origin main
```

### 3. Pull Code on VPS

```bash
ssh deploy@vmi2884766
cd ~/projects
rm -rf video-grabber  # Remove old version
git clone https://github.com/yourusername/video-grabber.git
cd video-grabber
```

### 4. Build and Deploy with Docker

```bash
# Build the Docker image
docker compose -f docker-compose.simple.yml build

# Start the container
docker compose -f docker-compose.simple.yml up -d

# View logs
docker compose -f docker-compose.simple.yml logs -f
```

### 5. Configure Nginx

Create `/etc/nginx/sites-available/video-grabber`:

```nginx
# API Subdomain: grabberapi.mxdhavgautam.com
server {
    listen 80;
    server_name grabberapi.mxdhavgautam.com;

    # SSL will be added by Certbot
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Increase timeouts for video processing
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
    }
}

# Main Domain: mxdhavgautam.com/grabber
server {
    listen 80;
    server_name mxdhavgautam.com www.mxdhavgautam.com;

    # SSL will be added by Certbot
    
    # Your existing Flutter portfolio root
    location / {
        # Your existing Vercel proxy or static files
        proxy_pass https://your-flutter-portfolio.vercel.app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # Video grabber frontend
    location /grabber {
        proxy_pass http://localhost:3001/grabber;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Video grabber API (from main domain)
    location /grabber/api {
        proxy_pass http://localhost:3001/grabber/api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS headers (if needed)
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/video-grabber /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Setup SSL with Certbot

```bash
sudo certbot --nginx -d grabberapi.mxdhavgautam.com -d mxdhavgautam.com
```

### 7. Test Deployment

```bash
# Test API health
curl https://grabberapi.mxdhavgautam.com/api/health

# Test video extraction
curl "https://grabberapi.mxdhavgautam.com/api/extract?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Test frontend
curl -I https://mxdhavgautam.com/grabber
```

### 8. Monitor and Maintain

```bash
# View container logs
docker compose -f docker-compose.simple.yml logs -f

# Restart container
docker compose -f docker-compose.simple.yml restart

# Update code
git pull origin main
docker compose -f docker-compose.simple.yml down
docker compose -f docker-compose.simple.yml up --build -d
```

## Important Notes

### Current Limitations

**YouTubeI.js Signature Cipher**: The current implementation uses YouTubeI.js which successfully extracts video metadata (title, duration, formats) but the download URLs require signature deciphering. This is a known limitation of using YouTube's InnerTube API without proper JavaScript evaluation.

**Workaround Options**:
1. Keep the old `server-node.mjs` with `yt-dlp` as fallback for actual downloads
2. Implement proper JavaScript evaluation for YouTubeI.js
3. Use a hybrid approach: YouTubeI.js for metadata, yt-dlp for downloads

### Why This Approach is Better

- **No Chrome/Puppeteer overhead** - Simpler, faster, less memory
- **No cookie management** - No need for authenticated sessions
- **Single container** - Frontend + backend together
- **More stable** - Less moving parts to fail

### Repository Structure

```
video-grabber/
├── src/                  # Frontend React source
├── public/               # Static assets
├── dist/                 # Built frontend (generated)
├── server-simple.mjs     # Simple server (YouTubeI.js)
├── server-node.mjs       # Complex server (yt-dlp + Puppeteer) - kept as backup
├── Dockerfile.simple     # Simplified Dockerfile
├── docker-compose.simple.yml  # Docker Compose config
├── package.json          # Dependencies
├── .env                  # Environment variables (now tracked)
├── .gitignore            # Minimal gitignore
└── README.md             # Documentation
```

### Troubleshooting

**Container won't start:**
```bash
docker compose -f docker-compose.simple.yml logs
```

**Nginx errors:**
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

**Port already in use:**
```bash
sudo lsof -i :3001
sudo kill -9 <PID>
```

## Success Criteria

✅ Frontend accessible at `https://mxdhavgautam.com/grabber`
✅ API accessible at `https://grabberapi.mxdhavgautam.com`
✅ Video metadata extraction working
✅ SSL certificates configured
✅ Container running and restarting on failures

