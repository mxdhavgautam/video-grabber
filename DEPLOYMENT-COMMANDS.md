# Deployment Commands for Hetzner VPS

## Step 1: SSH into VPS
```bash
ssh hetzner-madhav
```

## Step 2: Set Up Git Authentication (Choose One Method) ✅ COMPLETED

### Method A: SSH Key (Recommended) ✅ DONE

```bash
# Generate SSH key for GitHub
ssh-keygen -t ed25519 -f ~/.ssh/github_hetzner -C "hetzner-vps@github" -N ""

# Display public key - copy this to add to GitHub
cat ~/.ssh/github_hetzner.pub

# Configure SSH to use this key for GitHub
cat >> ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_hetzner
EOF

chmod 600 ~/.ssh/config

# Test GitHub connection
ssh -T git@github.com
```

**Status:** ✅ SSH key generated and GitHub connection tested successfully!

**⚠️ IMPORTANT: Add the SSH key to GitHub before cloning!**

Your public key is:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGXApaQm7H5/le4Ku4Jb2Fkcj00RHVdPhhUmR4SRI8J7 hetzner-vps@github
```

**Add it to GitHub:**
1. Go to: https://github.com/settings/keys
2. Click "New SSH key"
3. Title: "Hetzner VPS"
4. Paste the public key above
5. Click "Add SSH key"

### Method B: Personal Access Token (Not needed - using SSH)

```bash
# Clone using token (replace YOUR_TOKEN and YOUR_USERNAME)
git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/video-grabber.git ~/projects/video-grabber
```

## Step 3: Clone Repository ✅ COMPLETED

```bash
# Navigate to projects directory
cd ~/projects

# Clone repository (use SSH or HTTPS with token)
git clone git@github.com:mxdhavgautam/video-grabber.git video-grabber

cd video-grabber
```

**Status:** ✅ Repository cloned successfully!

## Step 4: Set Up Environment Variables ✅ COMPLETED

```bash
# Set up frontend environment
cp apps/frontend/.env.example apps/frontend/.env.production

# Edit frontend environment (use nano or vi)
nano apps/frontend/.env.production
# Set: VITE_API_URL=https://video-grabber-api.mxdhavgautam.com/api

# Set up backend environment
cp apps/backend/.env.example apps/backend/.env.production

# Edit backend environment
nano apps/backend/.env.production
# Set the following:
# NODE_ENV=production
# PORT=3001
# ALLOWED_ORIGINS=https://video-grabber.mxdhavgautam.com
# COOKIES_FILE=/var/lib/video-grabber/yt-dlp/cookies.txt
# CHROME_PROFILE_DIR=/var/lib/video-grabber/chrome-profiles
# YT_CIPHER_AUTH_SECRET=<generate-a-random-secret>
# YT_CIPHER_API_KEY=optional-api-key-if-needed
```

**Generate a random secret:**
```bash
openssl rand -hex 32
```

**Status:** ✅ Environment variables configured!

## Step 5: Create Persistent Storage Directories ✅ COMPLETED

```bash
# Create directories for persistent data
sudo mkdir -p /var/lib/video-grabber/yt-dlp
sudo mkdir -p /var/lib/video-grabber/chrome-profiles

# Set proper ownership
sudo chown -R madhav:madhav /var/lib/video-grabber

# Set permissions
sudo chmod -R 755 /var/lib/video-grabber
```

**Status:** ✅ Persistent storage directories created!

## Step 6: Handle Caddy (Stop System Caddy, Use Docker Caddy) ✅ COMPLETED

**Important:** The project includes Caddy as a Docker service. We will NOT use the system Caddy - we need to stop it to avoid port conflicts. The Docker Caddy service will handle all reverse proxy and SSL certificate management.

```bash
# Stop and disable system Caddy
sudo systemctl stop caddy
sudo systemctl disable caddy

# Verify it's stopped (should show "inactive (dead)")
sudo systemctl status caddy
```

**Status:** ✅ System Caddy stopped and disabled successfully!

**Note:** The project's Caddyfile is already configured at `infra/caddy/Caddyfile` with your domains. The Docker Caddy service will use this automatically.

**ACME Email Configuration:**
- Email: `mxdhavgautam@gmail.com` (will be set in Step 7)

The Caddyfile in the project is already configured with:
- `video-grabber.mxdhavgautam.com` → frontend
- `video-grabber-api.mxdhavgautam.com` → backend API

## Step 7: Build and Deploy ✅ COMPLETED

```bash
# Navigate to project directory
cd ~/projects/video-grabber

# Set environment variables for build
# ACME_EMAIL: Used by Caddy to obtain SSL certificates from Let's Encrypt
# VITE_API_URL: Must be set during build so frontend knows where to make API calls
export ACME_EMAIL=mxdhavgautam@gmail.com
export VITE_API_URL=https://video-grabber-api.mxdhavgautam.com/api

# Build and start all services (this will take several minutes)
docker compose up -d --build

# Check status - all services should show "Up" status
docker compose ps

# View logs (press Ctrl+C to exit)
docker compose logs -f
```

**Status:** ✅ Build completed successfully! All containers are running and healthy.

**Container Status:**
- ✅ `video-grabber-backend-1` - Up and healthy (port 3001)
- ✅ `video-grabber-frontend-1` - Up and healthy (port 8080)
- ✅ `video-grabber-caddy-1` - Up and running (ports 80, 443)

**Note:** SSL certificates obtained successfully! Both domains now have valid Let's Encrypt certificates. ✅

## Step 8: Verify Deployment

```bash
# Check if containers are running
docker compose ps

# Check backend health
curl http://localhost:3001/health
# Should return: {"status":"ok"}

# Check backend API endpoint
curl http://localhost:3001/api/extract \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=C84YEp-8-hI"}' \
  | head -20

# Check frontend (from your local machine or VPS)
curl -I http://localhost:8080
# Should return HTTP 200

# Check Caddy status
docker compose logs caddy --tail 50

# Test via HTTPS domains (SSL certificates now active!)
curl -I https://video-grabber.mxdhavgautam.com
curl -I https://video-grabber-api.mxdhavgautam.com/health

# Test API extraction via HTTPS
curl -X POST https://video-grabber-api.mxdhavgautam.com/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=C84YEp-8-hI"}' \
  | head -20
```

## Step 9: Domain DNS Configuration

Make sure your DNS records are set:

1. **For Frontend (video-grabber.mxdhavgautam.com):**
   - Type: A Record
   - Name: video-grabber (or @)
   - Value: 46.224.45.186
   - TTL: 300

2. **For Backend API (video-grabber-api.mxdhavgautam.com):**
   - Type: A Record
   - Name: video-grabber-api (or @)
   - Value: 46.224.45.186
   - TTL: 300

3. **Optional IPv6:**
   - Type: AAAA Record
   - Value: 2a01:4f8:c014:2805::1

## Step 10: Update Firewall (If Needed)

The firewall should already be configured, but verify:

```bash
sudo ufw status verbose
```

If ports 80 and 443 are not open, add them:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

## Important: YouTube Bot Detection (Expected Behavior)

**Current Status:** YouTube is blocking extraction requests with bot detection. This is normal and expected for server-side extraction without authentication.

**Solution:** Upload YouTube cookies via the frontend UI to bypass bot detection:

1. **Access the frontend:** `https://video-grabber.mxdhavgautam.com`
2. **Click the Cookie icon** (top right)
3. **Upload cookies.txt** from an authenticated YouTube session
4. **Cookies will be saved** and used for all subsequent extractions

**Note:** Without cookies, you'll see errors like:
- `"Sign in to confirm you're not a bot"` (yt-dlp)
- Empty formats array (youtubei.js fallback)

This is expected behavior. The application is working correctly - it just needs authenticated cookies to access YouTube content.

## Troubleshooting

### Check Container Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
```

### Restart Services
```bash
docker compose restart
# or specific service
docker compose restart backend
```

### Rebuild After Code Changes
```bash
docker compose down
docker compose up -d --build
```

### Check Disk Space
```bash
df -h
docker system df
```

### View Resource Usage
```bash
docker stats
htop
```

### Test API Endpoints
```bash
# Health check
curl http://localhost:3001/health

# Test extraction (replace with actual YouTube URL)
curl -X POST http://localhost:3001/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=C84YEp-8-hI"}'
```

## Updating the Application

```bash
# SSH into VPS
ssh hetzner-madhav

# Navigate to project
cd ~/projects/video-grabber

# Pull latest changes
git pull

# Rebuild and restart
docker compose down
docker compose up -d --build

# Check logs
docker compose logs -f
```

## Monitoring

```bash
# System resources
htop

# Docker containers
ctop
# or
lazydocker

# Docker stats
docker stats

# System info
fastfetch
```

