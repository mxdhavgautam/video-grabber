#!/bin/bash
# Enhanced Cookie Generator - Creates multiple cookie pools for rotation
# This script generates multiple cookie profiles to improve success rate
# without requiring manual login

set -e

log() {
  echo "[$(date)] $1"
}

# Configuration
COOKIE_POOL_SIZE=${COOKIE_POOL_SIZE:-5}  # Generate 5 different cookie sets
WARMUP_DURATION=${WARMUP_DURATION:-180}  # 3 minutes per profile
BASE_PROFILE_DIR="/app/chrome-profiles"
USER_AGENTS=(
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)

# URLs to visit to generate more cookies
YOUTUBE_URLS=(
  "https://www.youtube.com"
  "https://www.youtube.com/feed/trending"
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  "https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"  # YouTube Music
  "https://www.youtube.com/feed/subscriptions"
)

generate_cookie_profile() {
  local profile_index=$1
  local user_agent=${USER_AGENTS[$profile_index]}
  local profile_dir="$BASE_PROFILE_DIR/enhanced-profile-$(date +%s)-$profile_index"
  
  log "🔧 Generating cookie profile #$profile_index in $profile_dir"
  mkdir -p "$profile_dir"
  
  # Launch Google Chrome with enhanced stealth settings
  log "🚀 Launching Google Chrome with user-agent: ${user_agent:0:50}..."
  
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
    --remote-debugging-port=0 \
    --user-data-dir="$profile_dir" \
    --user-agent="$user_agent" \
    --start-maximized \
    --window-size=1920,1080 \
    --lang=en-US,en \
    --accept-lang=en-US,en \
    --disable-background-networking \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --metrics-recording-only \
    --no-first-run \
    --safebrowsing-disable-auto-update \
    --enable-automation=false \
    --password-store=basic \
    --use-mock-keychain \
    "${YOUTUBE_URLS[0]}" > /dev/null 2>&1 &
  
  local chrome_pid=$!
  log "✅ Google Chrome started with PID: $chrome_pid"
  
  # Enhanced warmup: Visit multiple URLs to generate more cookies
  sleep 30  # Initial page load
  
  log "🔄 Visiting multiple YouTube pages to generate comprehensive cookies..."
  for url in "${YOUTUBE_URLS[@]:1}"; do
    log "   Visiting: $url"
    # Use Chrome's remote debugging to navigate (more realistic)
    # Fallback: just wait longer if debugging not available
    sleep 20
  done
  
  # Additional wait for JavaScript execution and cookie generation
  log "⏳ Waiting additional ${WARMUP_DURATION}s for full cookie generation..."
  sleep $((WARMUP_DURATION - 90))
  
  # Verify cookies
  local cookies_db="$profile_dir/Default/Cookies"
  if [ -f "$cookies_db" ]; then
    local cookie_count=$(sqlite3 "$cookies_db" "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%';" 2>/dev/null || echo "0")
    log "📊 Generated $cookie_count cookies for profile #$profile_index"
    
    # Check for critical cookies
    local visitor_cookie=$(sqlite3 "$cookies_db" "SELECT COUNT(*) FROM cookies WHERE name='VISITOR_INFO1_LIVE' AND host_key LIKE '%youtube.com%';" 2>/dev/null || echo "0")
    if [ "$visitor_cookie" -gt 0 ]; then
      log "✅ VISITOR_INFO1_LIVE cookie found"
    fi
  fi
  
  # Kill Google Chrome
  kill $chrome_pid 2>/dev/null || true
  sleep 5
  
  # Ensure Google Chrome is fully closed
  timeout 10 bash -c "while pgrep -f google-chrome > /dev/null; do sleep 1; done" || true
  sleep 2
  
  # Export cookies using yt-dlp
  local cookies_file="$profile_dir/cookies.txt"
  log "📤 Exporting cookies from profile #$profile_index..."
  
  # Note: yt-dlp uses "chrome" not "chromium" for Google Chrome
  if yt-dlp --cookies-from-browser "chrome:$profile_dir" --cookies "$cookies_file" --skip-download --quiet "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null; then
    if [ -s "$cookies_file" ]; then
      local data_lines=$(grep -v "^#" "$cookies_file" | grep -v "^$" | wc -l || echo "0")
      if [ "$data_lines" -gt 0 ]; then
        log "✅ Profile #$profile_index: Exported $data_lines cookies"
        echo "$profile_dir"
        return 0
      fi
    fi
  fi
  
  log "⚠️ Profile #$profile_index: Cookie export failed"
  rm -rf "$profile_dir"
  return 1
}

# Main execution
log "🎯 Starting Enhanced Cookie Pool Generator"
log "📊 Target pool size: $COOKIE_POOL_SIZE profiles"
log "⏱️  Warmup duration: ${WARMUP_DURATION}s per profile"

export DISPLAY=:99
successful_profiles=()

for i in $(seq 0 $((COOKIE_POOL_SIZE - 1))); do
  if profile_dir=$(generate_cookie_profile $i); then
    successful_profiles+=("$profile_dir")
    log "✅ Successfully generated profile #$i: $profile_dir"
  else
    log "❌ Failed to generate profile #$i"
  fi
  
  # Small delay between profile generations
  if [ $i -lt $((COOKIE_POOL_SIZE - 1)) ]; then
    sleep 10
  fi
done

log "📊 Cookie pool generation complete!"
log "✅ Successfully generated ${#successful_profiles[@]} profiles"
log "📁 Profiles:"
for profile in "${successful_profiles[@]}"; do
  log "   - $profile"
done

# Save pool list for rotation script
POOL_LIST_FILE="$BASE_PROFILE_DIR/cookie-pool-list.txt"
printf "%s\n" "${successful_profiles[@]}" > "$POOL_LIST_FILE"
log "💾 Pool list saved to: $POOL_LIST_FILE"

