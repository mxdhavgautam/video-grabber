# Video Grabber 🎬

**Download YouTube videos reliably using Format 18** (360p) + FFmpeg.wasm processing. Deployed and working at **https://mxdhavgautam.com/grabber**

> ✅ Production-ready with Vercel (frontend) + Render (backend)

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
- 🟡 **Error Alerts** - Friendly, persistent error messages
- 🎚️ **Quality Selection** - 360p, 480p, 720p (upscaled)
- 📁 **Format Support** - MP4, WebM, MP3, M4A, OGG, WAV, AVI, MKV, FLV
- 🎵 **Audio Extraction** - Extract audio with language selection
- ⚡ **Fast Downloads** - Format 18 direct = instant (3-5s for 3min video)
- 🔒 **Secure** - CORS restricted to approved domains only

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript, Vite, shadcn/ui, Tailwind CSS |
| **Backend** | Node.js, youtubei.js, Render (24/7 persistent) |
| **Processing** | FFmpeg.wasm (client-side) |
| **Deployment** | Vercel (frontend) + Render (backend) |

---

## 🎯 How It Works

### The Format 18 Strategy

YouTube blocks high-quality formats (720p+, audio-only) with 403 errors. We use **Format 18** (360p combined):
- ✅ Never blocked by YouTube
- ✅ 100% reliability rate
- ⚠️ Quality limited to 360p
- ✅ Can upscale to 480p/720p (but slower)

**Flow**: YouTube Format 18 → Backend (download) → Browser (FFmpeg processing) → Download

### Performance

| Operation | Time |
|-----------|------|
| Extract metadata | 2-3 seconds |
| Format 18 download (3min video) | 3-5 seconds |
| Audio extraction | 30-60 seconds |
| Upscale 360p → 720p | 2-5 minutes |

---

## 🚀 Deploy Your Own

### Backend (Render)

```bash
# 1. New Web Service on Render
# 2. Connect GitHub repo
# 3. Environment variables:
PORT=3001
ALLOWED_ORIGINS=your-domain.com
NODE_ENV=production

# 4. Build: bun install
# 5. Start: bun server-node.mjs
```

### Frontend (Vercel)

```bash
# 1. Connect GitHub repo
# 2. Environment variable:
VITE_API_URL=https://your-render-backend.com

# 3. Deploy!
```

Both auto-deploy on git push to `main`.

---

## 🏗️ API Endpoints

**Backend**: `https://video-grabber-backend.onrender.com/`

- `GET /api/extract?url={youtube_url}` - Get video metadata
- `GET /api/download?url={youtube_url}&itag=18` - Download Format 18

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
- ✅ Keep Format 18 strategy (reliability over quality)
- ✅ Keep client-side processing
- ✅ Test with multiple videos before submitting
- ✅ Write clear commit messages explaining why

### Ideas for Contributors
- [ ] Playlist batch downloads
- [ ] Subtitle extraction
- [ ] Download history
- [ ] Keyboard shortcuts
- [ ] Dark mode
- [ ] Mobile app (React Native)
- [ ] Support other platforms (Vimeo, TikTok)
- [ ] Performance optimizations

### Issue Labels
- 🆘 `help wanted` - Need assistance
- 🐛 `bug` - Something broken
- ✨ `enhancement` - New feature idea
- 📚 `documentation` - Doc improvements
- 🎨 `ui-ux` - UI/UX feedback

---

## ❓ Questions?

- 💬 Open an issue with your question
- ⭐ Star the repo if you find it useful!

---

## 📄 License

**MIT License** - Use freely for personal, educational purposes.

---

## 🙏 Thanks To

- [youtubei.js](https://github.com/LuanRT/YouTube.js) - YouTube API client
- [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) - Client-side video processing
- [shadcn/ui](https://ui.shadcn.com) - React components
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [Vite](https://vitejs.dev) - Build tool
- [Render](https://render.com) & [Vercel](https://vercel.com) - Hosting

---

**Built with ❤️ for personal YouTube downloading**

**Want to contribute?** [Let's work together!](#-contributing) 🚀