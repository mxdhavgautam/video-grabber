FROM node:20-bookworm

ENV NODE_ENV=production \
    PUPPETEER_PRODUCT=chrome \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install system dependencies for yt-dlp, ffmpeg, Chromium, and Deno
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        curl \
        dumb-init \
        ffmpeg \
        fonts-liberation \
        gnupg \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgcc1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libstdc++6 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        python3 \
        python3-pip \
        unzip \
        wget \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for EJS runtime (latest version from GitHub releases)
RUN DENO_VERSION=$(curl -s https://api.github.com/repos/denoland/deno/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/') \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /tmp \
    && mv /tmp/deno /usr/local/bin/deno \
    && chmod +x /usr/local/bin/deno \
    && rm -rf /tmp/deno.zip \
    && deno --version

# Install latest yt-dlp from GitHub (nightly/master branch) with EJS support
# Using direct pip install from git to get bleeding-edge version
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "git+https://github.com/yt-dlp/yt-dlp.git@master#egg=yt-dlp[default]"

# Install bgutil-ytdlp-pot-provider plugin for automatic PO token handling
# This is the recommended PO Token provider plugin according to yt-dlp wiki
# Installing from PyPI (stable version) - use latest version
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    bgutil-ytdlp-pot-provider

# Copy npm manifests for workspace installation
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

# Install backend workspace dependencies only
RUN npm install --omit=dev --workspace @video-grabber/backend

# Copy backend source files
COPY apps/backend ./apps/backend

# Prepare persistent directories (mapped via volumes in docker-compose)
RUN mkdir -p /var/lib/video-grabber/yt-dlp /var/lib/video-grabber/chrome-profiles

# Default runtime configuration (can be overridden by env vars)
ENV PORT=3001 \
    COOKIES_FILE=/var/lib/video-grabber/yt-dlp/cookies.txt \
    CHROME_PROFILE_DIR=/var/lib/video-grabber/chrome-profiles

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/backend/src/index.mjs"]

