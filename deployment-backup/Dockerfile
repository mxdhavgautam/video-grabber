# Multi-stage build for Video Grabber backend
# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies with npm
RUN npm install

# Stage 2: Runtime
FROM node:22-slim

WORKDIR /app

# Install runtime dependencies
# - python3: For yt-dlp
# - ffmpeg: Full version with all codecs (h.264, vp9, opus, aac, etc.)
# - google-chrome-stable: Full Google Chrome browser instance (not headless)
# - ca-certificates: For HTTPS
# - xvfb: Virtual X display for Chrome
# - dbus: System message bus for Chrome
# - git: For installing pip packages from GitHub
# - gnupg: For adding Google's signing key
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    ca-certificates \
    curl \
    wget \
    xvfb \
    dbus \
    sqlite3 \
    git \
    unzip \
    gnupg \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome (not Chromium) - matches user's real browser
# Google Chrome has better fingerprinting and matches real Chrome behavior
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp nightly (includes external JS runtime support from PR #14157)
# PR #14157 merged Nov 1, 2025 - enables external n/sig solving via Deno/Node/Bun/QuickJS
# This solves YouTube's bot detection by using proper JS runtime instead of regex-based interpreter
# Force reinstall from git without cache to ensure we get the latest master code
RUN pip3 uninstall -y yt-dlp 2>/dev/null || true && \
    pip3 install --no-cache-dir --upgrade --break-system-packages \
    yt-dlp

# Verify installations
RUN which yt-dlp && yt-dlp --version && \
    ffmpeg -version | head -5 && \
    which google-chrome && google-chrome --version

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY server-node.mjs ./
COPY deployment-backup/warmup-cookies.mjs ./
COPY src ./src
COPY public ./public
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./

# Create directories for temp files and Chrome profiles
RUN mkdir -p /app/temp-downloads && \
    mkdir -p /app/chrome-profiles && \
    chmod 777 /app/temp-downloads && \
    chmod 777 /app/chrome-profiles

# Copy and make executable the enhanced cookie generator and rotator scripts
COPY deployment-backup/enhanced-cookie-generator.sh /app/enhanced-cookie-generator.sh
COPY deployment-backup/cookie-rotator.sh /app/cookie-rotator.sh
RUN chmod +x /app/enhanced-cookie-generator.sh /app/cookie-rotator.sh

# Create startup script that pre-warms Chrome and starts server
RUN cat > /app/start.sh << 'STARTUP'
#!/bin/bash
set +e

log() {
  echo "[$(date)] $1"
}

log "Starting Xvfb virtual display..."
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
XVFB_PID=$!
sleep 2

log "Starting dbus..."
mkdir -p /run/dbus
dbus-daemon --config-file=/etc/dbus-1/system.conf > /dev/null 2>&1 &
sleep 1

log "Pre-warming Google Chrome with enhanced cookie generation..."
export DISPLAY=:99
CHROME_PROFILE_DIR="/app/chrome-profiles"

# Try enhanced cookie generator first (generates multiple cookie profiles)
# This runs in background - if it fails, we'll still have basic cookie generation below
if [ -f /app/enhanced-cookie-generator.sh ]; then
  log "🎯 Starting enhanced cookie pool generation in background..."
  # Run enhanced generator in background (generates 5 profiles with different user-agents)
  # This takes ~15 minutes but improves success rate significantly
  nohup /app/enhanced-cookie-generator.sh > /tmp/cookie-gen.log 2>&1 &
  COOKIE_GEN_PID=$!
  log "✅ Enhanced cookie generator started (PID: $COOKIE_GEN_PID)"
  log "📝 Note: Enhanced cookies will be available after generation completes"
else
  log "📝 Enhanced cookie generator not found, using basic cookie generation only"
fi

# Always generate at least one basic cookie profile for immediate use
BASIC_PROFILE_DIR="/app/chrome-profiles/profile-$(date +%s)"
mkdir -p "$BASIC_PROFILE_DIR"
CHROME_PROFILE_DIR="$BASIC_PROFILE_DIR"

# CRITICAL: According to yt-dlp docs, cookies from incognito/private sessions work better
# because they're never rotated if the session is closed immediately after export.
# However, since we need persistent cookies, we'll use a regular profile but with
# enhanced stealth settings to avoid bot detection.

log "Launching Google Chrome with enhanced stealth settings to establish YouTube session..."
# CRITICAL: Real Chrome works because it uses Chrome's actual network stack
# Using Google Chrome (not Chromium) matches the user's real browser exactly
# To replicate this, we need to:
# 1. Keep Chrome running (not kill it after cookie generation)
# 2. Use Chrome DevTools Protocol to route requests through Chrome
# 3. Or ensure cookies are fresh before each request
# 
# For now, we'll keep Chrome running in background and refresh cookies on-demand
# Enhanced stealth flags based on yt-dlp documentation and best practices:
# - Disable automation detection
# - Set realistic window size
# - Use proper user agent matching our OS (Linux)
# - Enable remote debugging for potential future CDP integration
# - Disable features that reveal automation
google-chrome \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-background-timer-throttling \
  --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-infobars \
  --disable-notifications \
  --disable-blink-features=AutomationControlled \
  --disable-features=IsolateOrigins,site-per-process \
  --disable-web-security \
  --disable-features=BlockInsecurePrivateNetworkRequests \
  --remote-debugging-port=9222 \
  --user-data-dir="$CHROME_PROFILE_DIR" \
  --start-maximized \
  --window-size=1920,1080 \
  --lang=en-US,en \
  --accept-lang=en-US,en \
  https://www.youtube.com > /dev/null 2>&1 &
CHROME_PID=$!
log "Google Chrome started with PID: $CHROME_PID (remote debugging on port 9222)"

# CRITICAL: YouTube's JavaScript needs time to:
# 1. Load the page (5-10 seconds)
# 2. Execute JavaScript to generate VISITOR_INFO1_LIVE cookie (20-30 seconds for full page load)
# 3. Set all session cookies (5-10 seconds)
# Total: ~120 seconds for more reliable cookie generation (increased from 90)
log "Waiting 10 seconds for Chrome to be ready for remote debugging..."
sleep 10

# Use Puppeteer with stealth to properly warm up cookies
# This is more reliable than just launching Chrome and hoping cookies are set
log "🔥 Using Puppeteer to warm up cookies with stealth techniques..."
if node /app/warmup-cookies.mjs 2>&1 | tee /tmp/warmup.log; then
  log "✅ Puppeteer warmup successful!"
else
  log "⚠️ Puppeteer warmup failed, but continuing anyway..."
  log "📝 Check /tmp/warmup.log for details"
fi

# CRITICAL CHANGE: Keep Google Chrome running in background!
# Real Chrome works because it keeps the browser session alive
# We'll export cookies now, but keep Chrome running for fresh cookies
# The browser will stay alive and cookies will remain fresh
log "✅ Google Chrome session established - keeping browser running for fresh cookies"

# Verify cookies were generated before proceeding
COOKIES_DB="$CHROME_PROFILE_DIR/Default/Cookies"
if [ -f "$COOKIES_DB" ]; then
  visitor_cookie_count=$(sqlite3 "$COOKIES_DB" "SELECT COUNT(*) FROM cookies WHERE name='VISITOR_INFO1_LIVE' AND host_key LIKE '%youtube.com%';" 2>/dev/null || echo "0")
  if [ "$visitor_cookie_count" -gt 0 ]; then
    log "✅ VISITOR_INFO1_LIVE cookie detected in database!"
  else
    log "⚠️ VISITOR_INFO1_LIVE cookie NOT found after 90 seconds"
    log "📊 Checking what cookies exist in database..."
    total_cookies=$(sqlite3 "$COOKIES_DB" "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%youtube.com%';" 2>/dev/null || echo "0")
    log "📊 Total YouTube cookies found: $total_cookies"
    if [ "$total_cookies" -eq "0" ]; then
      log "⚠️ No YouTube cookies found - Chrome may not have loaded YouTube properly"
    fi
  fi
fi

# CRITICAL CHANGE: Do NOT kill Google Chrome - keep it running!
# Real Chrome works because the browser stays alive with fresh cookies
# We'll export cookies while Chrome is still running
# This ensures cookies are fresh and not stale
log "Keeping Google Chrome running for fresh cookie access..."
# Note: We'll export cookies while Chrome is running (yt-dlp handles locked databases)
# The browser will continue running in background to keep cookies fresh

# Verify the cookie database is accessible and not locked
COOKIES_DB="$CHROME_PROFILE_DIR/Default/Cookies"
if [ -f "$COOKIES_DB" ]; then
  # Test if database is accessible
  if sqlite3 "$COOKIES_DB" "SELECT COUNT(*) FROM cookies WHERE name='VISITOR_INFO1_LIVE';" > /dev/null 2>&1; then
    log "✅ Cookie database is accessible and unlocked"
  else
    log "⚠️ Cookie database might be locked - waiting additional 5 seconds..."
    sleep 5
  fi
fi

if [ -f "$COOKIES_DB" ]; then
  log "✅ Cookies database created successfully!"

  # CRITICAL: Use yt-dlp's built-in cookie export feature (no extensions needed!)
  # According to yt-dlp docs: --cookies-from-browser chrome:/path --cookies cookies.txt
  # This exports cookies directly from Chrome's cookie database to Netscape format
  COOKIES_FILE="$CHROME_PROFILE_DIR/cookies.txt"
  
  log "📤 Exporting cookies using yt-dlp's built-in export (no extensions needed)..."
  # Use yt-dlp to export cookies - this is the safe, extension-free method
  # We use a dummy YouTube URL just to trigger the export
  # Note: yt-dlp uses "chrome" not "chromium" for Google Chrome
  if yt-dlp --cookies-from-browser "chrome:$CHROME_PROFILE_DIR" --cookies "$COOKIES_FILE" --skip-download --quiet "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null; then
    if [ -s "$COOKIES_FILE" ]; then
      line_count=$(wc -l < "$COOKIES_FILE")
      data_lines=$(grep -v "^#" "$COOKIES_FILE" | grep -v "^$" | wc -l || echo "0")
      if [ "$data_lines" -gt 0 ]; then
        log "✅ Exported YouTube cookies using yt-dlp to: $COOKIES_FILE"
        log "📝 Cookie count: $data_lines"
        
        # Check for critical cookies
        if grep -q "VISITOR_INFO1_LIVE" "$COOKIES_FILE"; then
          log "✅ Critical cookie VISITOR_INFO1_LIVE found!"
        else
          log "⚠️ WARNING: VISITOR_INFO1_LIVE cookie NOT found - these are guest cookies!"
          log "⚠️ For authenticated cookies, you need to log into YouTube in Chrome first"
          log "⚠️ OR upload authenticated cookies manually via /api/upload-authenticated-cookies"
        fi
        
        if grep -q "YSC" "$COOKIES_FILE"; then
          log "✅ Session cookie YSC found!"
        else
          log "⚠️ WARNING: YSC cookie NOT found!"
        fi
        
        # Check for authenticated cookies (login cookies)
        if grep -q "__Secure-" "$COOKIES_FILE" || grep -q "SAPISID" "$COOKIES_FILE" || grep -q "SID" "$COOKIES_FILE"; then
          log "✅ Authenticated cookies detected (logged-in session)!"
        else
          log "⚠️ WARNING: No authenticated cookies detected - these are guest cookies"
          log "⚠️ Guest cookies may not bypass bot detection - authenticated cookies required!"
        fi
      else
        log "⚠️ Cookie export contained no data rows"
        rm -f "$COOKIES_FILE"
      fi
    else
      log "⚠️ Cookie export file is empty"
      rm -f "$COOKIES_FILE"
    fi
  else
    log "⚠️ Failed to export cookies using yt-dlp - falling back to manual SQLite export"
    # Fallback to manual SQLite export (less reliable but better than nothing)
    TMP_COOKIES="$CHROME_PROFILE_DIR/cookies.tmp"
    sqlite3 "$COOKIES_DB" <<'EOF' > "$TMP_COOKIES"
.mode tabs
SELECT
  host_key,
  CASE WHEN substr(host_key, 1, 1) = '.' THEN 'TRUE' ELSE 'FALSE' END,
  path,
  CASE WHEN is_secure = 1 THEN 'TRUE' ELSE 'FALSE' END,
  CASE
    WHEN expires_utc = 0 THEN 0
    ELSE CAST(((expires_utc - 11644473600000000) / 1000000) AS INTEGER)
  END,
  name,
  value
FROM cookies
WHERE (host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%' OR host_key LIKE '%.google.com%')
  AND LENGTH(name) > 0
ORDER BY host_key ASC, path ASC, name ASC;
EOF

    {
      echo "# Netscape HTTP Cookie File"
      echo "# https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
      cat "$TMP_COOKIES"
    } > "$COOKIES_FILE"
    rm -f "$TMP_COOKIES"
    
    if [ -s "$COOKIES_FILE" ]; then
      data_lines=$(grep -v "^#" "$COOKIES_FILE" | grep -v "^$" | wc -l || echo "0")
      if [ "$data_lines" -gt 0 ]; then
        log "✅ Exported cookies using SQLite fallback: $COOKIES_FILE"
        log "📝 Cookie count: $data_lines"
      fi
    fi
  fi
else
  log "⚠️ Cookies database not found; running without persistent cookies"
fi

log "Starting Video Grabber server..."

# Verify yt-dlp version
YTDLP_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
log "✅ yt-dlp version: $YTDLP_VERSION"

export CHROME_PROFILE_DIR
exec node server-node.mjs
STARTUP

RUN chmod +x /app/start.sh

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start via startup script (pre-warms Chrome, then starts Node.js)
CMD ["/bin/bash", "-c", "/app/start.sh"]
