# Implementation Plan: Google OAuth Integration for YouTube Video Extraction

## Executive Summary

**FEASIBILITY: ✅ YES - This approach is FEASIBLE and RECOMMENDED**

Integrating Google OAuth authentication to use each user's YouTube credentials for video extraction and downloading is **technically feasible** and will significantly improve reliability, security, and access to highest quality formats.

**Key Decision**: Use OAuth for user authentication → Extract cookies from authenticated session → Use cookies with yt-dlp for downloads.

## Technology Stack & Requirements

### Core Technologies

**OAuth & Authentication**:
- **Passport.js** with `passport-google-oauth20` (Express-friendly, open source)
- Google OAuth 2.0 credentials setup required

**Cookie Extraction**:
- **youtubei.js** - For extracting cookies from OAuth sessions (no browser automation needed)

**Video Downloading**:
- **yt-dlp** - Latest stable release `2025.10.22` or newer (use `master` branch, NOT `main`)
- **ffmpeg** - For merging video/audio streams

**JavaScript Runtime** (REQUIRED):
- **Deno 2.0.0+** (recommended - sandboxed, single-file, most secure)
- Alternatives: Node 20.0.0+, Bun 1.0.31+, or QuickJS (require CLI args)
- **Why Required**: Next yt-dlp release will mandate external JS runtime for YouTube downloads (YouTube's JS challenges too complex for built-in interpreter)

**Python**:
- **Python 3.10+** required (3.9 EOL October 2025)

**Database**:
- **SQLite** with `better-sqlite3` (self-hosted, open source, WAL mode for concurrency)

### Current yt-dlp Status (November 2025)

**Latest Release**: `2025.10.22` (October 22, 2025)
- **Status**: Temporary stopgap release with partial YouTube support fix
- **Branch**: `master` (confirmed via GitHub releases)
- **Recent Fixes**: HTTP 403 Forbidden (Issue #14680) and signature/nsig extraction (Issue #14707) both fixed
- **Known Issues**: Some formats may be unavailable with cookies (temporary limitation)

**Upcoming Requirement**: External JavaScript runtime (Deno/Node/Bun/QuickJS) will be **MANDATORY** in next release
- **Timeline**: "Very soon" - next release expected imminently
- **Impact**: Must install Deno 2.0.0+ in Docker container before next yt-dlp update
- **Future Benefit**: Will also enable PO (Proof-of-Origin) token generation and improve bot detection bypass using AST-based approach

**Bot Protection Status**:
- ⚠️ **ONGOING ISSUE**: Bot detection still active, even with cookies
- Cookies significantly help but don't fully eliminate bot detection
- Deno/JS runtime will improve bypass (AST-based vs current regex approach)
- User's own cookies + IP address + conservative rate limiting = best current approach

## Architecture Decisions

### 1. OAuth → Cookies → yt-dlp Flow

**Why NOT Direct OAuth with yt-dlp**:
- Direct OAuth tokens cause HTTP 400 errors with yt-dlp
- yt-dlp documentation explicitly recommends cookies over OAuth
- OAuth tokens work in browsers but not with yt-dlp's HTTP requests

**Recommended Approach**:
1. User authenticates via Google OAuth in browser
2. Extract YouTube session cookies from authenticated OAuth session using youtubei.js
3. Convert cookies to Netscape format
4. Store cookies per-user (encrypted)
5. Pass user-specific cookies to yt-dlp using `--cookies` flag

### 2. Browser Automation: COMPLETELY REMOVED

**Current State** (to be removed):
- Puppeteer/Chrome for cookie generation
- Browser interception for video extraction
- Automated browsing patterns
- Tor proxy setup
- Shared browser instances

**New Approach**:
- User authenticates in their own browser (OAuth flow)
- youtubei.js extracts cookies from OAuth session (no browser needed)
- When cookies expire: invalidate session → prompt user to re-login
- **Result**: No browser automation, better concurrency, stateless architecture

### 3. Per-User Cookie Storage

**Requirements**:
- Store cookies per user: `cookies/user-{userId}.txt`
- Use Netscape cookie format (yt-dlp standard)
- Encrypt cookie files at rest
- Cookies expire typically after 30 days (invalidate session, prompt re-login)

### 4. youtubei.js: OAuth & Cookie Extraction Only

**Use youtubei.js for**:
- ✅ OAuth2 authentication flow
- ✅ Cookie extraction from authenticated sessions
- ✅ Video metadata extraction

**Do NOT use youtubei.js for**:
- ❌ Actual video downloading (limited to 360p, unreliable)
- ❌ High-quality format access (yt-dlp is proven and reliable)

**Hybrid Approach**: youtubei.js handles auth → extracts cookies → yt-dlp uses cookies for downloads

## Implementation Architecture

### User Flow

```
1. User clicks "Sign in with Google"
   ↓
2. OAuth2 flow (Google consent screen + CAPTCHA if needed)
   ↓
3. User grants permissions (solves CAPTCHA in their browser)
   ↓
4. Backend receives OAuth tokens
   ↓
5. Use youtubei.js to extract cookies from OAuth session
   (No browser automation - uses OAuth tokens directly)
   ↓
6. Convert cookies to Netscape format
   ↓
7. Store cookies per-user (encrypted in SQLite)
   ↓
8. User requests video download
   ↓
9. Check rate limit (30 videos/hour max)
   ↓
10. Load user's cookies from SQLite
   ↓
11. Execute yt-dlp with user's cookies and Deno runtime
   ↓
12. Download video in highest quality
   ↓
13. If cookies expired: invalidate session, prompt re-login
```

### Database Schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  cookie_file_path TEXT,
  cookie_last_updated INTEGER,
  cookie_expires_at INTEGER,
  rate_limit_count INTEGER DEFAULT 0,
  rate_limit_reset_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_google_id ON users(google_id);
CREATE INDEX idx_email ON users(email);
```

**Encryption**: Use Node.js `crypto` module to encrypt tokens/cookies before storage.

### yt-dlp Command Structure

```bash
# Basic command with user cookies
yt-dlp -f "bestvideo+bestaudio/best" --cookies /path/to/user-cookies.txt "URL"

# With Deno runtime (when required by next release)
yt-dlp --js-runtime deno -f "bestvideo+bestaudio/best" --cookies /path/to/user-cookies.txt "URL"
```

## What Can Be Removed/Replaced

### ✅ Can Be Removed Completely

1. **Cookie Generator Service** (`cookie-generator.mjs`)
   - Automated browsing to generate cookies
   - Browser warmup sessions
   - Cookie refresh automation

2. **Browser Interception** (`extractWithBrowserInterception`)
   - Network request interception
   - Browser-based video extraction

3. **Tor Proxy Setup**
   - Tor proxy configuration
   - Exit node IP rotation
   - User's own IP is better for bot detection

4. **Shared Cookie File**
   - Single `cookies.txt` file
   - Replace with per-user cookie storage

5. **Bot Detection Workarounds**
   - Browser stealth plugins
   - Mouse movement simulation
   - Browsing pattern simulation

6. **Puppeteer/Chrome Dependencies**
   - Can be removed entirely from package.json
   - No browser automation needed

### ⚠️ Can Be Simplified

1. **YouTube Extractor**
   - Remove browser interception logic
   - Keep yt-dlp extraction
   - Add per-user cookie loading
   - Add Deno runtime support

2. **Cookie Management**
   - Replace automated generation with OAuth-based extraction
   - Keep cookie refresh logic (but use OAuth refresh → user re-login)

### ✅ Must Keep/Enhance

1. **yt-dlp Integration**
   - Core extraction and downloading
   - Format parsing
   - FFmpeg integration
   - Deno runtime support (upcoming requirement)

2. **Error Handling**
   - Bot detection error handling (still needed, though reduced)
   - Rate limiting
   - Token refresh logic
   - Cookie expiration handling

3. **Manual Cookie Upload Endpoint**
   - ❌ **REMOVE**: Manual cookie export/upload (not needed, better UX)
   - Automated extraction via youtubei.js is sufficient

## Implementation Steps

### Phase 0: Infrastructure Prerequisites

**Critical Setup** (Must be done first):

1. **Update Dockerfile**:
   ```dockerfile
   # Install Deno 2.0.0+
   RUN curl -fsSL https://deno.land/install.sh | sh
   ENV PATH="/root/.deno/bin:${PATH}"
   
   # Update Python to 3.10+
   FROM python:3.10-slim
   ```

2. **Update yt-dlp**:
   - Use latest release `2025.10.22` or newer
   - Monitor for next release requiring Deno
   - Test yt-dlp with Deno before OAuth implementation

3. **Verify Dependencies**:
   - Deno 2.0.0+ installed and accessible
   - Python 3.10+ confirmed
   - ffmpeg installed
   - yt-dlp working with current setup

### Phase 1: OAuth Integration

1. Install dependencies:
   ```bash
   npm install passport passport-google-oauth20 express-session
   ```

2. Set up Google OAuth credentials:
   - Create OAuth 2.0 credentials in Google Cloud Console
   - Configure redirect URIs
   - Store credentials securely (environment variables)

3. Implement OAuth flow in backend:
   - Configure Passport.js with Google OAuth strategy
   - Set up `/auth/google` and `/auth/google/callback` routes
   - Handle OAuth tokens and user profile

4. Store OAuth tokens securely:
   - Encrypt access_token and refresh_token
   - Store in SQLite database (user table)

### Phase 2: Cookie Extraction

1. Install youtubei.js:
   ```bash
   npm install @distube/youtubei
   ```

2. Integrate youtubei.js for OAuth session management:
   - Use OAuth tokens to create authenticated youtubei.js session
   - Extract cookies from authenticated session

3. Convert cookies to Netscape format:
   - Parse cookies from youtubei.js
   - Convert to yt-dlp compatible Netscape cookie format
   - Validate cookie format

4. Store per-user cookies:
   - Save to `cookies/user-{userId}.txt`
   - Encrypt cookie files at rest
   - Store cookie metadata in SQLite (path, expiration, last updated)

### Phase 3: Update YouTube Extractor

1. Modify extractor to load user-specific cookies:
   - Add user authentication check
   - Load cookies from user's cookie file
   - Handle missing/invalid cookies (prompt re-login)

2. Remove browser interception:
   - Remove `extractWithBrowserInterception` method
   - Remove all Puppeteer-related code

3. Update yt-dlp calls:
   - Use `--cookies` flag with user's cookie file
   - Add Deno runtime support: `--js-runtime deno` (when required)
   - Keep format selection: `-f "bestvideo+bestaudio/best"`
   - Remove browser-related arguments

4. Implement cookie expiration handling:
   - Check cookie expiration before download
   - Invalidate session if cookies expired
   - Prompt user to re-authenticate

### Phase 4: Remove Browser Dependencies

1. Remove CookieGenerator service:
   - Delete `apps/backend/src/services/cookie-generator.mjs`
   - Remove from server initialization
   - Remove from YouTubeExtractor constructor

2. Remove browser interception code:
   - Delete browser interception methods
   - Remove network request interception logic

3. Remove Puppeteer/Chrome dependencies:
   - Remove from `package.json`
   - Remove Chrome installation from Dockerfile
   - Remove browser profile directories

4. Remove Tor proxy setup:
   - Remove Tor configuration
   - Remove proxy-related code

5. Clean up imports and references:
   - Remove unused imports
   - Update server initialization
   - Remove browser-related environment variables

### Phase 5: Database & Rate Limiting

1. Set up SQLite database:
   - Install `better-sqlite3`
   - Create database schema
   - Enable WAL mode for concurrency

2. Implement user schema and encryption:
   - Create user table with all required fields
   - Implement encryption functions for tokens/cookies
   - Create indexes for performance

3. Implement strict rate limiting:
   - 30 videos/hour per user (very conservative, well below YouTube's 2000/hour limit)
   - Per-user rate limit tracking in database
   - Reset rate limits after time window
   - Return appropriate error messages when limit exceeded

4. Test per-user isolation:
   - Verify cookies never leak between users
   - Test concurrent access
   - Verify rate limits are per-user

5. Test concurrent downloads:
   - Multiple users downloading simultaneously
   - Verify no conflicts or resource contention

### Phase 6: Testing & Security

1. Test cookie extraction from OAuth:
   - Verify cookies are extracted correctly
   - Verify Netscape format conversion
   - Test with various OAuth scenarios

2. Test cookie expiration handling:
   - Simulate expired cookies
   - Verify session invalidation
   - Verify re-authentication prompt

3. Test rate limiting enforcement:
   - Verify limits are enforced per-user
   - Test reset behavior
   - Test error messages

4. Security audit:
   - Verify encryption of tokens/cookies
   - Verify per-user isolation
   - Test access control (user can only use their cookies)
   - Audit logging implementation

5. Concurrency testing:
   - Multiple simultaneous downloads
   - Multiple users authenticating
   - Verify no race conditions

6. CAPTCHA handling verification:
   - Verify CAPTCHA is handled during OAuth
   - Test OAuth flow with CAPTCHA challenges

7. Bot detection testing:
   - Monitor for bot detection errors
   - Test with various video formats
   - Verify highest quality access with authenticated cookies

## Security Considerations

### Critical

1. **Cookie Storage**: Encrypt all cookie files at rest
2. **Token Storage**: Encrypt OAuth tokens before database storage
3. **Per-User Isolation**: Ensure cookies never leak between users
4. **Access Control**: Verify user owns cookies before use (check user ID matches)

### Important

1. **Token Refresh**: Handle OAuth token expiration with refresh tokens
2. **Cookie Expiration**: Invalidate session when cookies expire, prompt re-login
3. **Rate Limiting**: Strict per-user rate limits (30 videos/hour)
4. **Audit Logging**: Log all authentication events, cookie access, and download attempts

### Account Safety

**Mitigation Strategies**:
- ✅ **STRICT rate limiting**: 30 videos/hour max (very conservative, well below YouTube's 2000/hour limit)
- ✅ **No unauthenticated users**: Require auth for all downloads (better bot detection bypass)
- ✅ **Per-user isolation**: Each user's cookies completely separate
- ✅ **CAPTCHA during login**: User solves CAPTCHA in their browser during OAuth (helps with bot detection)
- ✅ **Monitor for bot detection errors**: Alert user if issues detected
- ✅ **Clear user warnings**: Inform users about risks and rate limits

**Risks (still present)**:
- Account bans if YouTube detects automated downloading patterns
- Rate limiting per account (2000 videos/hour for authenticated users vs 300 for guests)
- Users must be informed about risks

## Performance Benefits

### Expected Improvements

1. **Reliability**: ✅ Higher (user-specific sessions, authenticated access)
2. **Speed**: ✅ Faster (no browser automation overhead)
3. **Resource Usage**: ✅ Lower (no browser instances, no Puppeteer)
4. **Scalability**: ✅ Better (stateless per-user, no shared resources)
5. **Quality**: ✅ Higher (authenticated access to better formats, though some formats may be temporarily unavailable with cookies)

## Risks and Mitigations

### Risks

1. **Account Bans**: Users' accounts could be banned if detected
   - **Mitigation**: Rate limiting (30 videos/hour), user warnings, best practices

2. **Cookie Expiration**: Cookies expire (30 days typically)
   - **Mitigation**: Invalidate session when expired, prompt user to re-login (no automation)

3. **OAuth Token Expiration**: Tokens expire
   - **Mitigation**: Refresh token rotation, handle gracefully

4. **YouTube Policy Changes**: YouTube may change authentication
   - **Mitigation**: Monitor yt-dlp updates, flexible architecture

5. **Bot Detection**: Ongoing issue, even with cookies
   - **Mitigation**: User's own cookies + IP, conservative rate limiting, Deno runtime (upcoming)

6. **Format Limitations**: Some formats may be unavailable with cookies (temporary)
   - **Mitigation**: Monitor yt-dlp updates, use latest release, Deno runtime should help

## Final Recommendations

### Technology Stack

- **OAuth**: Passport.js with passport-google-oauth20
- **Cookie Extraction**: youtubei.js (no browser automation)
- **Storage**: SQLite (better-sqlite3) - self-hosted, open source
- **Downloading**: yt-dlp + ffmpeg (reliable, high-quality)
- **JavaScript Runtime**: Deno 2.0.0+ (REQUIRED for upcoming yt-dlp releases)
- **Python Version**: 3.10+ (required, 3.9 EOL)
- **yt-dlp Version**: 2025.10.22 or newer (master branch)
- **Rate Limiting**: 30 videos/hour per user (very conservative)
- **Authentication**: Required for all users (no unauthenticated access)
- **CAPTCHA**: Handled by Google during OAuth (user solves in browser)
- **Concurrency**: Full support (stateless, per-user isolation)
- **Browser Automation**: Completely removed (no Puppeteer/Chrome)

### Key Benefits

- ✅ No browser automation overhead (better concurrency)
- ✅ Reliable high-quality downloads (yt-dlp + user cookies + Deno)
- ✅ Account safety (conservative rate limits, user's own IP)
- ✅ Scalable architecture (stateless, per-user)
- ✅ Self-hosted database (no external dependencies)
- ✅ Better UX (automated cookie extraction, no manual steps)
- ✅ Future-proof (Deno runtime ready for next yt-dlp release)

### Estimated Development Time

**2-3 weeks** for full implementation (including testing and security audit)

### Next Steps

1. ✅ Update infrastructure (Deno, Python 3.10+, latest yt-dlp)
2. ✅ Implement OAuth2 authentication
3. ✅ Build cookie extraction from OAuth sessions
4. ✅ Implement per-user cookie storage
5. ✅ Update YouTube extractor with user cookies and Deno support
6. ✅ Remove browser automation dependencies
7. ✅ Test thoroughly
8. ✅ Monitor for next yt-dlp release requiring Deno

This architecture will provide a more reliable, secure, and scalable solution for YouTube video downloads while giving users full control over their accounts and keeping them safe from bans.
