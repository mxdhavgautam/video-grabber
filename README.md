# Video Grabber 🎬

**Download YouTube videos in multiple formats using automatic format selection.** Deployed and working at **https://mxdhavgautam.com/grabber**

> ✅ Production-ready with Vercel (frontend) + VPS Docker (backend) + yt-dlp + FFmpeg

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
- 🤖 **Bot Detection Bypass** - Server-side Chrome profile management
- 🔐 **Secure Codec Handling** - Filters unsupported AV1 codec automatically
- ⚡ **Real-time Progress** - Server-Sent Events for download updates
- 🔒 **Secure** - CORS restricted to approved domains only

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript, Vite, shadcn/ui, Tailwind CSS |
| **Backend** | Node.js (Bun), yt-dlp, Docker, VPS with Ubuntu 24.04 |
| **Processing** | FFmpeg (server-side) + client-side video assembly |
| **Video Download** | yt-dlp with Chrome profile cookies |
| **Deployment** | Vercel (frontend) + Custom VPS (backend) |
| **Infrastructure** | Docker + Docker Compose, Xvfb, Chromium |

---

## 🎯 How It Works

### Codec Support

**Supported Video Codecs:**
- ✅ **H.264 (AVC)** - Fastest, fully supported
- ✅ **VP9** - Supported, slower but works
- ❌ **AV1** - Not supported (auto-filtered)

**Why AV1 is filtered:** Browser environment lacks reliable AV1 decoding support. The application automatically excludes AV1 formats and selects H.264 or VP9 instead.

### Download Flow

1. **Extract Metadata** - yt-dlp queries video info (JSON format)
2. **Smart Format Selection** - Algorithm picks best compatible codec
3. **Parallel Download** - Video + Audio downloaded from YouTube
4. **Merge & Process** - FFmpeg combines and processes on server
5. **Download to User** - Final file sent to browser

### Performance

| Operation | Time |
|-----------|------|
| Extract metadata | 2-3 seconds |
| Download video | 10-60 seconds (depends on quality) |
| Audio extraction | 30-60 seconds |
| Format conversion | 1-5 minutes |

---

## 🚀 Deploy Your Own

### Backend Architecture

The backend uses a **private Docker container** on a custom VPS with:

- **Docker containerization** - Isolated, reproducible environment
- **Chromium** - Full browser instance (not headless) for YouTube bot detection
- **FFmpeg** - Server-side video processing with all codecs
- **yt-dlp** - YouTube metadata extraction and downloading
- **Xvfb** - Virtual X display for Chromium
- **Daily Chrome Profile Rotation** - Fresh cookies every 24 hours
- **Auto-Cleanup** - Temporary files cleaned every 30 minutes

**For your own deployment:**

1. Prepare a VPS (Ubuntu 24.04, 8GB+ RAM, Docker installed)
2. Copy deployment files from `deployment-backup/` folder (kept private, not in git)
3. Configure Docker Compose with your domains
4. Run `docker-compose up -d`

Detailed setup guide available in private `deployment-backup/DEPLOYMENT_INSTRUCTIONS.md`

### Frontend (Vercel)

**Setup Steps:**

1. **Create Vercel Project**
   - Go to [vercel.com](https://vercel.com)
   - Connect your GitHub repo
   - Configure build settings

2. **Set Environment Variable**
   ```
   VITE_API_URL=https://your-backend-api.com
   ```

3. **Deploy**
   - Vercel will auto-deploy on git push
   - Build command: `bun run build`
   - Output directory: `dist`

---

## 🔐 API Endpoints

### Backend

**Base URL:** `https://api.yourdomain.com/` (your configured backend)

- `GET /extract?url={youtube_url}` - Extract video metadata
- `GET /download?url={youtube_url}&format={format_id}` - Download specific format
- `GET /health` - Health check

### CORS Handling

All requests include CORS headers validated against configured origins:
- Requests from approved domains ✅ Allowed
- Requests from unknown origins ❌ Blocked
- Preflight OPTIONS requests ✅ Handled automatically

---

## 🎬 Video Processing Pipeline

**Backend (VPS + Docker):**

1. **Chrome Profile Management** - Daily rotation, automatic cleanup
2. **yt-dlp Extraction** - Queries YouTube with browser-like behavior
3. **Format Detection** - Identifies all available codecs and qualities
4. **Smart Selection** - Chooses best format matching user preferences
5. **Concurrent Downloads** - Max 3 parallel downloads (configurable)
6. **FFmpeg Processing** - Merges video/audio, converts formats
7. **Cleanup** - Removes temp files, rotates Chrome profiles

**Frontend (Vercel + React):**

1. **URL Input** - User pastes YouTube link
2. **API Call** - Requests metadata from backend
3. **Format Display** - Shows available qualities and formats
4. **Download** - Streams file to user's browser
5. **Progress Tracking** - Real-time updates via Server-Sent Events

---

## 🏗️ Project Structure

```
video-grabber/
├── server-node.mjs          # Backend server (Node.js/Bun)
├── src/
│   ├── lib/
│   │   ├── video-extractor.ts   # Frontend API client
│   │   └── types.ts             # TypeScript types
│   ├── components/
│   │   ├── VideoGrabber.tsx     # Main UI component
│   │   └── CookiePermissionDialog.tsx
│   └── App.tsx
├── deployment-backup/       # Private deployment configs (gitignored)
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── build-and-deploy.sh
│   └── DEPLOYMENT_INSTRUCTIONS.md
├── vite.config.ts           # Vite build config
├── tsconfig.json            # TypeScript config
├── package.json             # Dependencies
└── README.md                # This file
```

---

## ⚙️ Configuration Files

### deployment-backup/ (Private)
- `Dockerfile` - Multi-stage Docker build configuration
- `docker-compose.yml` - Service orchestration
- `build-and-deploy.sh` - Automated deployment script
- `DEPLOYMENT_INSTRUCTIONS.md` - Comprehensive setup guide

*These files are NOT committed to git for security. Keep them in `deployment-backup/` locally.*

### vite.config.ts
- Base path: `/grabber/` for subdirectory deployment
- Proxy: `/grabber/api` → backend (dev)

### vercel.json
- Frontend deployment configuration
- API rewrites to backend

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
- ✅ Maintain codec filtering logic
- ✅ Test CORS configuration if adding new endpoints
- ✅ Write clear commit messages

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
- Check backend logs for errors
- Verify network connectivity
- Try a lower quality video

### CORS errors
- Verify API URL is correctly configured
- Check browser dev tools Network tab
- Ensure frontend can reach backend

### No compatible formats
- Some videos are geo-blocked or age-restricted
- YouTube's restrictions prevent downloading certain content

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
- [FFmpeg](https://ffmpeg.org/) - Video processing
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [shadcn/ui](https://ui.shadcn.com) - React components
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [Vite](https://vitejs.dev) - Build tool
- [Docker](https://docker.com) - Containerization
- [Vercel](https://vercel.com) - Frontend hosting

---

**Built with ❤️ for reliable YouTube downloading**

**Want to contribute?** [Let's work together!](#-contributing) 🚀