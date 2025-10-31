# Video Grabber 🎬

**Download YouTube videos in multiple formats using automatic format selection.** Deployed and working at **https://mxdhavgautam.com/grabber**

> ✅ Production-ready with Vercel (frontend) + Render (backend) + yt-dlp + FFmpeg.wasm

---

## 🚀 Try It Now

**No installation needed:** Visit https://mxdhavgautam.com/grabber

**Or run locally:**
```bash
git clone https://github.com/mxdhavgautam/video-grabber.git
cd video-grabber
bun install && bun run dev
# Opens at http://localhost:5173/grabber/
```

---

## ✨ Features

- 📋 **Paste Button** - One-click clipboard paste for YouTube URLs
- 🎚️ **Smart Quality Selection** - Auto-selects best compatible format
- 📁 **Format Support** - MP4, WebM, MP3, M4A, OGG, WAV, AVI, MKV, FLV
- 🎵 **Audio Extraction** - Extract audio with language selection  
- 🤖 **Bot Detection Bypass** - Optional YouTube cookie integration
- 🔐 **Secure Codec Handling** - Filters unsupported AV1 codec automatically
- ⚡ **Real-time Progress** - Server-Sent Events for download updates
- 🔒 **Secure** - CORS restricted to approved domains only

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript, Vite, shadcn/ui, Tailwind CSS |
| **Backend** | Node.js (Bun), yt-dlp, Render (24/7 persistent) |
| **Processing** | FFmpeg.wasm (client-side) + yt-dlp (server-side) |
| **Video Download** | yt-dlp with Netscape cookies.txt format |
| **Deployment** | Vercel (frontend) + Render (backend) |

---

## 🎯 How It Works

### Codec Support

**Supported Video Codecs:**
- ✅ **H.264 (AVC)** - Fastest, fully supported
- ✅ **VP9** - Supported, slower but works
- ❌ **AV1** - Not supported (auto-filtered)

**Why AV1 is filtered:** Browser FFmpeg WASM lacks reliable AV1 decoding support. The application automatically excludes AV1 formats and selects H.264 or VP9 instead.

### Download Flow

1. **Extract Metadata** - yt-dlp queries video info (JSON format)
2. **Smart Format Selection** - Algorithm picks best compatible codec
3. **Parallel Download** - Video + Audio downloaded from YouTube
4. **Merge & Process** - FFmpeg.wasm combines and processes on client
5. **Download to User** - Final file saved to user's device

### Performance

| Operation | Time |
|-----------|------|
| Extract metadata | 2-3 seconds |
| Download video | 10-60 seconds (depends on quality) |
| Audio extraction | 30-60 seconds |
| Format conversion | 1-5 minutes |

---

## 🚀 Deploy Your Own

### Backend (Render)

**Requirements:**
- Node.js 18+ (Render provides this)
- Python 3 + yt-dlp (installed during build)
- Bun for running server

**Setup Steps:**

1. **Create Render Web Service**
   - Go to [render.com](https://render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repo

2. **Configure Build & Start**
   ```
   Build Command: apt-get update && apt-get install -y python3 python3-pip && pip3 install yt-dlp && bun install
   Start Command: bun server-node.mjs
   ```

3. **Set Environment Variables**
   ```
   PORT=3001
   ALLOWED_ORIGINS=https://your-frontend-domain.com,https://another-domain.com
   NODE_ENV=production
   ```

4. **Deploy**
   - Render will automatically build and deploy on git push

**Important CORS Configuration:**
```
ALLOWED_ORIGINS=https://www.yourdomain.com,https://yourdomain.com,https://app.vercel.com
```
- Backend validates each request origin against this list
- Supports multiple comma-separated domains
- Set to specific domains in production (never use `*` in production)

### Frontend (Vercel)

**Setup Steps:**

1. **Create Vercel Project**
   - Go to [vercel.com](https://vercel.com)
   - Connect your GitHub repo
   - Configure build settings

2. **Set Environment Variable**
   ```
   VITE_API_URL=https://your-render-backend.onrender.com
   ```

3. **Deploy**
   - Vercel will auto-deploy on git push
   - Build command: `bun run build`
   - Output directory: `dist`

Both services auto-deploy on git push to `main` branch.

---

## 🔐 API Endpoints

### Backend (Render)

**Base URL:** `https://video-grabber-backend.onrender.com/`

- `GET /extract?url={youtube_url}` - Extract video metadata
- `GET /download?url={youtube_url}&format={format_id}` - Download specific format
- `GET /api/progress?format={format_id}` - Real-time SSE progress updates
- `POST /api/enable-cookies` - Submit YouTube cookies for bot bypass

### CORS Handling

All requests include CORS headers validated against `ALLOWED_ORIGINS`:
- Requests from approved domains ✅ Allowed
- Requests from unknown origins ❌ Blocked
- Preflight OPTIONS requests ✅ Handled automatically

---

## 🎬 yt-dlp Configuration

**Backend yt-dlp Setup (Render):**

1. **Installation**: Automatic via build command
   ```bash
   pip3 install --upgrade yt-dlp
   ```

2. **Configuration**: Server uses file-based command-line args
   ```javascript
   // No global config needed - args passed directly
   spawn('yt-dlp', ['-f', formatId, '-o', tempPath, videoUrl, ...cookieFlags])
   ```

3. **Cookie Support**: Two modes
   - **File-based**: `--cookies {file_path}` (production)
   - **Browser-based**: Frontend extracts Chrome cookies, sends to backend

4. **Format IDs**: Queried via `-j --dump-single-json` flag
   - AV1 formats automatically skipped
   - H.264 and VP9 preferred

---

## 🏗️ Project Structure

```
video-grabber/
├── server-node.mjs          # Backend server (Node.js)
├── src/
│   ├── lib/
│   │   ├── video-extractor.ts   # Frontend API client
│   │   ├── ffmpeg.ts            # Client-side video processing
│   │   └── types.ts             # TypeScript types
│   ├── components/
│   │   ├── VideoGrabber.tsx     # Main UI component
│   │   └── CookiePermissionDialog.tsx
│   └── App.tsx
├── render.yaml              # Render deployment config
├── vercel.json              # Vercel deployment config
├── vite.config.ts           # Vite build config
├── tsconfig.json            # TypeScript config
└── package.json             # Dependencies
```

---

## ⚙️ Configuration Files

### render.yaml
- Defines Render service configuration
- Specifies build and start commands
- Sets environment variables
- **Update ALLOWED_ORIGINS** before deploying

### vite.config.ts
- Base path: `/grabber/` for subdirectory deployment
- Proxy: `/grabber/api` → `http://localhost:3001/api` (dev)
- CORS headers for FFmpeg.wasm: `Cross-Origin-Embedder-Policy: require-corp`

### vercel.json
- Frontend deployment configuration
- Rewrites API calls to backend
- CORS headers for FFmpeg.wasm support

---

## 🤝 Contributing

**We'd love your help!** 🙌

### Quick Start
```bash
git checkout -b feature/your-idea
bun run dev
# Make changes, test with multiple videos
git push origin feature/your-idea
# Open a PR!
```

### Guidelines
- ✅ Test with multiple video types
- ✅ Maintain AV1 codec filtering
- ✅ Keep client-side processing where possible
- ✅ Write clear commit messages
- ✅ Test CORS configuration if adding new endpoints

### Ideas for Contributors
- [ ] Playlist batch downloads
- [ ] Subtitle extraction with proper encoding
- [ ] Download history (local storage)
- [ ] Keyboard shortcuts
- [ ] Mobile-responsive improvements
- [ ] Support other platforms (Vimeo, TikTok)
- [ ] Performance optimizations

---

## ❓ Troubleshooting

### "Failed to get video information"
- Check if YouTube has updated their API
- Verify yt-dlp is up-to-date: `pip3 install --upgrade yt-dlp`
- Try a different video URL

### Download times out
- Render free tier may throttle large downloads
- Try a lower quality/smaller video
- Consider upgrading to Render paid plan

### CORS errors
- Verify `ALLOWED_ORIGINS` includes your frontend domain
- Check browser dev tools Network tab
- Ensure both frontend and backend are running

### No compatible formats
- Some videos are geo-blocked or age-restricted
- YouTube's restrictions prevent downloading certain content
- Try enabling YouTube cookies via the UI

---

## ❓ Questions?

- 💬 [Open an issue](https://github.com/mxdhavgautam/video-grabber/issues) with your question
- ⭐ Star the repo if you find it useful!

---

## 📄 License

**MIT License** - Use freely for personal, educational purposes.

---

## 🙏 Thanks To

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloader
- [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) - Client-side video processing
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [shadcn/ui](https://ui.shadcn.com) - React components
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [Vite](https://vitejs.dev) - Build tool
- [Render](https://render.com) & [Vercel](https://vercel.com) - Hosting

---

**Built with ❤️ for reliable YouTube downloading**

**Want to contribute?** [Let's work together!](#-contributing) 🚀