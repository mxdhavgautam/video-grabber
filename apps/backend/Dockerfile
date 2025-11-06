FROM node:20-bookworm

ENV NODE_ENV=production

WORKDIR /app

# Install system dependencies for yt-dlp, ffmpeg, Deno, and Chromium
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        curl \
        dumb-init \
        ffmpeg \
        gnupg \
        netcat-openbsd \
        python3 \
        python3-pip \
        unzip \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer environment variables to use system Chromium
ENV PUPPETEER_PRODUCT=chrome \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Deno 2.0.0+ for EJS runtime (required for upcoming yt-dlp releases)
# Using explicit version check to ensure 2.0.0+ is installed
RUN DENO_VERSION=$(curl -s https://api.github.com/repos/denoland/deno/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/') \
    && echo "Installing Deno version: ${DENO_VERSION}" \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /tmp \
    && mv /tmp/deno /usr/local/bin/deno \
    && chmod +x /usr/local/bin/deno \
    && rm -rf /tmp/deno.zip \
    && deno --version \
    && python3 --version

# Install curl_cffi first (required for impersonation)
# curl_cffi uses curl-impersonate to mimic real browser TLS fingerprints
# Install system dependencies for curl_cffi if needed
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    curl-cffi

# Install latest yt-dlp from GitHub (nightly/master branch) with EJS support
# Using direct pip install from git to get bleeding-edge version
# Include curl_cffi extra to ensure compatibility
# curl_cffi is installed separately above to avoid dependency conflicts
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "git+https://github.com/yt-dlp/yt-dlp.git@master#egg=yt-dlp[default,curl_cffi]"

# Verify curl_cffi installation
RUN python3 -c "import curl_cffi; print('curl_cffi version:', curl_cffi.__version__)" || echo "curl_cffi verification failed"

# Install bgutil-ytdlp-pot-provider plugin for automatic PO token handling
# This is the recommended PO Token provider plugin according to yt-dlp wiki
# Installing from PyPI (stable version) - use latest version
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    bgutil-ytdlp-pot-provider

# Note: CAPTCHA solving removed - OAuth handles authentication via Google

# Copy npm manifests for workspace installation
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

# Install backend workspace dependencies only
RUN npm install --omit=dev --workspace @video-grabber/backend

# Copy backend source files
COPY apps/backend ./apps/backend

# Prepare persistent directories (mapped via volumes in docker-compose)
# OAuth cookies stored per-user, database for user management, Chrome profiles per-user
RUN mkdir -p /var/lib/video-grabber/yt-dlp \
    /var/lib/video-grabber/cookies \
    /var/lib/video-grabber/database \
    /var/lib/video-grabber/chrome-profiles

# Default runtime configuration (can be overridden by env vars)
ENV PORT=3001 \
    COOKIES_DIR=/var/lib/video-grabber/cookies \
    DATABASE_PATH=/var/lib/video-grabber/database/video-grabber.db \
    CHROME_PROFILE_DIR=/var/lib/video-grabber/chrome-profiles

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/backend/src/index.mjs"]

