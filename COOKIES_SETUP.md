# Setting Up YouTube Cookies for yt-dlp

If you encounter "Sign in to confirm you're not a bot" errors, you can provide your YouTube cookies to bypass bot detection.

## Quick Setup (3 Steps)

### Step 1: Export Your Cookies
Choose your browser and install the appropriate extension:

**For Chrome:**
1. Install: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/edibdbjcniadpccecjdfdjjppcpchdlm)
2. Visit: https://www.youtube.com/
3. Log in to your YouTube account (or use one that is already logged in)
4. Click the extension icon → "Export" → Save the `cookies.txt` file

**For Firefox:**
1. Install: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Visit: https://www.youtube.com/
3. Log in to your YouTube account
4. Click the extension icon → Save as `cookies.txt`

### Step 2: Place Cookies File
Save the `cookies.txt` file in your project:
```bash
mkdir -p .yt-dlp
# Move your exported cookies.txt to .yt-dlp/cookies.txt
mv ~/Downloads/cookies.txt .yt-dlp/cookies.txt
```

### Step 3: Restart Server
```bash
# Kill the running server
pkill -f "server-node.mjs"

# Restart it
bun server-node.mjs
```

You should see: `🔐 Using cookies from: /path/to/.yt-dlp/cookies.txt`

## Production Deployment (Render/Vercel)

### Option 1: Using Environment Variables (Recommended)

1. Export and encode your `cookies.txt`:
   ```bash
   base64 -w 0 .yt-dlp/cookies.txt > cookies.b64
   cat cookies.b64
   ```

2. Add to Render dashboard as environment variable:
   ```
   COOKIES_FILE_CONTENT=<base64-encoded-content>
   ```

3. The server will automatically decode and use it

### Option 2: Using GitHub Secrets

1. Store base64-encoded cookies as GitHub Secret: `YOUTUBE_COOKIES`
2. In deployment, write to `.yt-dlp/cookies.txt` before starting

## Important Notes

⚠️ **Account Safety:**
- Using your personal account carries a risk of being banned by YouTube
- **Recommended**: Create a secondary/throwaway account for downloading
- Keep your cookies file secure and don't commit it to Git (`.yt-dlp/` is gitignored)

⚠️ **Cookie Expiration:**
- Cookies expire periodically (usually after weeks/months)
- If downloads fail again, re-export your cookies
- Update the `.yt-dlp/cookies.txt` file

✅ **Legal & Terms:**
- Ensure downloads comply with YouTube's Terms of Service
- Respect copyright and only download content you have permission to download
- Check local laws regarding video downloading in your jurisdiction

## Troubleshooting

**Error: "No cookies file found"**
- Ensure file exists at `.yt-dlp/cookies.txt`
- Check file permissions: `ls -la .yt-dlp/cookies.txt`

**Error: "Invalid cookies format"**
- Re-export cookies from your browser
- Ensure the file is valid: `head -5 .yt-dlp/cookies.txt`

**Still getting bot detection?**
- Cookies may have expired, re-export them
- YouTube may have updated its detection
- Try a different browser or account
- Wait a few hours before retrying (rate limiting)

## Browser Extension References

- Chrome: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/edibdbjcniadpccecjdfdjjppcpchdlm
- Firefox: https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/

## yt-dlp Documentation

- Main Wiki: https://github.com/yt-dlp/yt-dlp/wiki
- Cookies FAQ: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
- Extractors: https://github.com/yt-dlp/yt-dlp/wiki/Extractors
