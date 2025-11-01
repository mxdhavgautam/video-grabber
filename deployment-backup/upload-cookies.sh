#!/bin/bash
# Helper script to upload authenticated YouTube cookies to the video-grabber backend
# This is required to bypass YouTube bot detection
#
# IMPORTANT: Do NOT use "Get cookies.txt" extension (malware)!
# Safe options:
# - "Get cookies.txt LOCALLY" extension for Chrome (safe)
# - "cookies.txt" extension for Firefox (safe)
# - OR use yt-dlp's built-in export: yt-dlp --cookies-from-browser chrome --cookies cookies.txt

set -e

API_URL="${API_URL:-http://localhost:3001}"
COOKIES_FILE="${1:-cookies.txt}"

if [ ! -f "$COOKIES_FILE" ]; then
  echo "❌ Error: Cookies file not found: $COOKIES_FILE"
  echo ""
  echo "Usage: $0 [path-to-cookies.txt]"
  echo ""
  echo "METHOD 1: Using Browser Extension (Safe Extensions Only)"
  echo "========================================================"
  echo "1. Open Chrome in private/incognito mode"
  echo "2. Log into YouTube"
  echo "3. Navigate to https://www.youtube.com/robots.txt (ONLY tab in incognito)"
  echo "4. Use SAFE extension:"
  echo "   - Chrome: 'Get cookies.txt LOCALLY' (NOT 'Get cookies.txt' - that's malware!)"
  echo "   - Firefox: 'cookies.txt' extension"
  echo "5. Export ONLY youtube.com cookies"
  echo "6. Close the incognito window immediately (to prevent cookie rotation)"
  echo "7. Save exported cookies to a file (e.g., cookies.txt)"
  echo "8. Run: $0 cookies.txt"
  echo ""
  echo "METHOD 2: Using yt-dlp Built-in Export (NO EXTENSIONS NEEDED)"
  echo "==============================================================="
  echo "1. Open Chrome (regular session, NOT incognito)"
  echo "2. Log into YouTube"
  echo "3. Run: yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download 'https://www.youtube.com'"
  echo "4. Run: $0 cookies.txt"
  echo ""
  echo "METHOD 3: Copy from Docker Container"
  echo "===================================="
  echo "If you have authenticated cookies in a Docker container:"
  echo "  docker cp container:/path/to/cookies.txt ./cookies.txt"
  echo "  $0 cookies.txt"
  exit 1
fi

echo "📤 Uploading authenticated cookies from: $COOKIES_FILE"
echo "   API URL: $API_URL"

# Validate cookies file format
if ! head -1 "$COOKIES_FILE" | grep -q "# Netscape HTTP Cookie File\|# HTTP Cookie File"; then
  echo "⚠️  Warning: Cookies file may not be in correct format"
  echo "   Expected first line: '# Netscape HTTP Cookie File' or '# HTTP Cookie File'"
fi

# Read cookies file
COOKIES_CONTENT=$(cat "$COOKIES_FILE")

# Check if jq is available
if ! command -v jq &> /dev/null; then
  echo "⚠️  Warning: jq not found, using basic JSON encoding"
  # Basic JSON encoding (escape quotes and newlines)
  ESCAPED_COOKIES=$(echo "$COOKIES_CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' 'n' | sed 's/n/\\n/g')
  JSON_PAYLOAD="{\"cookies\": \"$ESCAPED_COOKIES\"}"
else
  JSON_PAYLOAD="{\"cookies\": $(echo "$COOKIES_CONTENT" | jq -Rs .)}"
fi

# Upload to API
RESPONSE=$(curl -s -X POST "$API_URL/api/upload-authenticated-cookies" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

# Check response
if echo "$RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Cookies uploaded successfully!"
  echo ""
  if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
  else
    echo "$RESPONSE"
  fi
  
  # Check if authenticated cookies were detected
  if echo "$RESPONSE" | grep -q '"hasAuthenticatedCookies":true'; then
    echo ""
    echo "✅ Authenticated cookies detected - bot detection should be bypassed!"
  else
    echo ""
    echo "⚠️  Warning: No authenticated cookies detected - these may be guest cookies"
    echo "   Guest cookies may not bypass bot detection - authenticated cookies required!"
  fi
else
  echo "❌ Failed to upload cookies"
  if command -v jq &> /dev/null; then
    echo "$RESPONSE" | jq '.'
  else
    echo "$RESPONSE"
  fi
  exit 1
fi

