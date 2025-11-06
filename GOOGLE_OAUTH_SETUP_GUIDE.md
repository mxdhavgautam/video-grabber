# Google OAuth Setup Guide for Video Grabber

## ⚠️ IMPORTANT: Is Google OAuth Free?

**YES, Google OAuth is 100% FREE** for the use case in this project:
- ✅ **OAuth 2.0 API is free** - No charges for authentication
- ✅ **YouTube Data API not required** - We're using OAuth only for authentication, not accessing YouTube Data API
- ✅ **No API quotas** - Since we're not using YouTube Data API, there are no quotas or limits
- ✅ **Open source friendly** - Google OAuth is open source and widely used

**What we're using:**
- Google OAuth 2.0 for user authentication (FREE)
- YouTube session cookies extracted from authenticated sessions (FREE)
- No YouTube Data API calls (no API costs)

**What we're NOT using:**
- YouTube Data API v3 (this would require API key and has quotas)
- Google Cloud Platform compute resources (we're self-hosting)

**Cost: $0.00** - This setup is completely free! 🎉

---

## Step-by-Step: Google Cloud Console Setup

### Step 1: Access Google Cloud Console

1. **Go to Google Cloud Console:**
   - URL: https://console.cloud.google.com/
   - Sign in with your Google account (the one you want to use for OAuth)

2. **If you don't have a project:**
   - Click the project dropdown at the top (next to "Google Cloud")
   - Click "NEW PROJECT"
   - **Project Name:** `video-grabber-oauth` (or any name you prefer)
   - **Project ID:** Auto-generated (you can customize if needed)
   - Click "CREATE"
   - Wait for project creation (10-30 seconds)

3. **Select your project:**
   - Click the project dropdown
   - Select the project you just created (or existing project)

---

### Step 2: Enable Google+ API (OAuth 2.0)

**Note:** OAuth 2.0 doesn't actually require enabling any API, but we need to configure OAuth consent screen.

1. **Navigate to OAuth Consent Screen:**
   - In the left sidebar, click "APIs & Services"
   - Click "OAuth consent screen"

2. **Choose User Type:**
   - **Option 1: External** (for public users)
     - Select "External" (recommended for public app)
     - Click "CREATE"
   - **Option 2: Internal** (only for Google Workspace)
     - Only available if you have Google Workspace
     - Select "Internal" if you have Google Workspace

**We'll proceed with External (most common):**

---

### Step 3: Configure OAuth Consent Screen

Fill in the following information:

#### App Information:
1. **App name:** 
   - Enter: `Video Grabber`
   - (This is what users will see when they sign in)

2. **User support email:**
   - Select: Your email address from dropdown
   - (e.g., `mxdhavgautam@gmail.com`)

3. **App logo:** (Optional)
   - Click "UPLOAD"
   - Upload your app logo (if you have one)
   - Recommended size: 120x120 pixels
   - Format: PNG, JPG, or GIF
   - **Skip this if you don't have a logo**

4. **Application home page:**
   - Enter: `https://video-grabber.mxdhavgautam.com`
   - (Your frontend domain)

5. **Application privacy policy link:**
   - Enter: `https://video-grabber.mxdhavgautam.com/privacy`
   - (Or create a privacy policy page, or use a placeholder)
   - **Note:** This is required for production, optional for testing

6. **Application terms of service link:** (Optional)
   - Enter: `https://video-grabber.mxdhavgautam.com/terms`
   - (Or leave empty for testing)

7. **Authorized domains:**
   - Click "ADD DOMAIN"
   - Enter: `mxdhavgautam.com`
   - (Your domain without subdomain)
   - **Important:** This must match your actual domain

8. **Developer contact information:**
   - Enter: Your email address
   - (e.g., `mxdhavgautam@gmail.com`)

9. **Click "SAVE AND CONTINUE"**

---

### Step 4: Configure Scopes

1. **Scopes page will appear**

2. **Click "ADD OR REMOVE SCOPES"**

3. **In the filter/search box, search for and select:**
   - `.../auth/userinfo.email` (View your email address)
   - `.../auth/userinfo.profile` (View your basic profile info)
   - `openid` (Associate you with your personal Google account)

4. **Click "UPDATE"**

5. **Click "SAVE AND CONTINUE"**

6. **Test users (for External apps):**
   - Since your app is in "Testing" mode, you need to add test users
   - Click "ADD USERS"
   - Enter your Google email address
   - Click "ADD"
   - **Note:** Only test users can sign in until you publish the app

7. **Click "SAVE AND CONTINUE"**

8. **Summary page:**
   - Review your settings
   - Click "BACK TO DASHBOARD"

---

### Step 5: Create OAuth 2.0 Credentials

1. **Navigate to Credentials:**
   - In left sidebar, click "APIs & Services"
   - Click "Credentials"

2. **Create OAuth Client ID:**
   - Click "+ CREATE CREDENTIALS" at the top
   - Select "OAuth client ID"

3. **If prompted about OAuth consent screen:**
   - Click "CONFIGURE CONSENT SCREEN" if you haven't completed it
   - Otherwise, continue

4. **Application type:**
   - Select: **"Web application"**
   - (This is for server-side OAuth)

5. **Name:**
   - Enter: `Video Grabber Web Client`
   - (Or any descriptive name)

6. **Authorized JavaScript origins:**
   - Click "ADD URI"
   - Enter: `https://video-grabber.mxdhavgautam.com`
   - (Your frontend domain with https://)
   - **Important:** Must match your actual frontend URL exactly

7. **Authorized redirect URIs:**
   - Click "ADD URI"
   - Enter: `https://video-grabber-api.mxdhavgautam.com/auth/google/callback`
   - (Your backend API domain + `/auth/google/callback`)
   - **CRITICAL:** This must match exactly what your backend expects
   - **Format:** `https://your-backend-domain/auth/google/callback`

8. **Click "CREATE"**

---

### Step 6: Obtain Your Credentials

After creating the OAuth client, you'll see a popup with:

1. **Your Client ID:**
   - Example: `123456789-abcdefghijklmnop.apps.googleusercontent.com`
   - **COPY THIS** - You'll need it for `GOOGLE_CLIENT_ID`

2. **Your Client Secret:**
   - Example: `GOCSPX-abcdefghijklmnopqrstuvwxyz`
   - **COPY THIS** - You'll need it for `GOOGLE_CLIENT_SECRET`
   - ⚠️ **IMPORTANT:** This is only shown once! Save it securely!

3. **Click "OK"**

---

### Step 7: Save Your Credentials Securely

**Create a secure note or document with:**

```
GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
```

**Also note down:**
- **Redirect URI:** `https://video-grabber-api.mxdhavgautam.com/auth/google/callback`
- **Frontend URL:** `https://video-grabber.mxdhavgautam.com`
- **Backend API URL:** `https://video-grabber-api.mxdhavgautam.com`

---

### Step 8: View/Copy Credentials Later (If Needed)

If you need to view your credentials again:

1. **Go to:** https://console.cloud.google.com/apis/credentials
2. **Find your OAuth 2.0 Client ID** (named "Video Grabber Web Client")
3. **Click on it** to view details
4. **Client ID:** Visible in the details
5. **Client Secret:** Click "RESET SECRET" or view if shown (usually hidden)

---

### Step 9: Publish Your App (Optional - For Production)

**Currently your app is in "Testing" mode:**
- Only test users can sign in
- Limited to 100 test users
- Shows "unverified app" warning

**To publish (remove limitations):**

1. **Go to OAuth consent screen:**
   - APIs & Services → OAuth consent screen

2. **Click "PUBLISH APP"**

3. **Confirm publishing**

4. **After publishing:**
   - Anyone can sign in (no test user limit)
   - Still shows "unverified app" warning until you verify

**To remove "unverified app" warning:**
- Requires Google verification process
- Only needed if you want to remove the warning
- Not required for functionality

---

## Environment Variables Setup

After completing the Google Cloud Console setup, you'll need these environment variables:

### Backend Environment Variables (.env.production)

Add these to `apps/backend/.env.production`:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here

# OAuth Session Configuration
SESSION_SECRET=generate-a-random-secret-here
SESSION_COOKIE_NAME=video-grabber-session
SESSION_COOKIE_MAX_AGE=86400000  # 24 hours in milliseconds

# OAuth Redirect Configuration (already set in code, but document here)
OAUTH_REDIRECT_URI=https://video-grabber-api.mxdhavgautam.com/auth/google/callback
FRONTEND_URL=https://video-grabber.mxdhavgautam.com
```

### Generate SESSION_SECRET

Run this command to generate a secure random secret:

```bash
openssl rand -hex 32
```

Copy the output and use it as `SESSION_SECRET`.

---

## Redirect URI Configuration Details

### Why Redirect URI is Important

The redirect URI is where Google sends users after they authenticate. It must:

1. **Match exactly** what's configured in Google Cloud Console
2. **Use HTTPS** in production (Google requires HTTPS for OAuth)
3. **Be on your backend domain** (not frontend)

### Your Redirect URI Format

```
https://video-grabber-api.mxdhavgautam.com/auth/google/callback
```

**Breakdown:**
- `https://` - Protocol (required for production)
- `video-grabber-api.mxdhavgautam.com` - Your backend API domain
- `/auth/google/callback` - The callback path (set in code)

### Multiple Environments (Optional)

If you have multiple environments (dev, staging, production), add all redirect URIs:

**In Google Cloud Console, add multiple redirect URIs:**
1. `https://video-grabber-api.mxdhavgautam.com/auth/google/callback` (Production)
2. `http://localhost:3001/auth/google/callback` (Local development - optional)
3. `https://staging-api.yourdomain.com/auth/google/callback` (Staging - optional)

---

## Testing Checklist

Before deploying, verify:

- [ ] OAuth consent screen configured
- [ ] Test users added (if app is in Testing mode)
- [ ] OAuth client ID created
- [ ] OAuth client secret saved securely
- [ ] Redirect URI matches backend endpoint
- [ ] JavaScript origins include frontend domain
- [ ] Environment variables set in backend `.env.production`
- [ ] SESSION_SECRET generated and set
- [ ] HTTPS enabled on both frontend and backend domains

---

## Troubleshooting

### "Redirect URI mismatch" Error

**Problem:** Google returns "redirect_uri_mismatch" error

**Solution:**
1. Check that redirect URI in Google Cloud Console matches exactly
2. Check for trailing slashes (should NOT have one)
3. Check for http vs https mismatch
4. Wait 5-10 minutes after updating (Google caches changes)

### "Access blocked: This app's request is invalid" Error

**Problem:** App is in Testing mode and user isn't added as test user

**Solution:**
1. Go to OAuth consent screen
2. Add user's email as test user
3. Or publish the app (for production)

### "Error 400: invalid_client" Error

**Problem:** Client ID or Client Secret is incorrect

**Solution:**
1. Verify GOOGLE_CLIENT_ID matches exactly
2. Verify GOOGLE_CLIENT_SECRET matches exactly
3. Check for extra spaces or newlines
4. Regenerate client secret if needed

---

## Security Best Practices

1. **Never commit credentials to Git:**
   - Use `.env.production` file (already in .gitignore)
   - Never share credentials publicly

2. **Rotate secrets periodically:**
   - Regenerate SESSION_SECRET every 6-12 months
   - Regenerate OAuth client secret if compromised

3. **Use HTTPS only:**
   - OAuth requires HTTPS in production
   - Ensure SSL certificates are valid

4. **Limit redirect URIs:**
   - Only add redirect URIs you actually use
   - Remove unused redirect URIs

---

## Quick Reference

**Google Cloud Console:**
- Main Console: https://console.cloud.google.com/
- OAuth Consent Screen: https://console.cloud.google.com/apis/credentials/consent
- Credentials: https://console.cloud.google.com/apis/credentials

**Your Configuration:**
- Frontend: `https://video-grabber.mxdhavgautam.com`
- Backend API: `https://video-grabber-api.mxdhavgautam.com`
- Redirect URI: `https://video-grabber-api.mxdhavgautam.com/auth/google/callback`

**Required Environment Variables:**
- `GOOGLE_CLIENT_ID` - From OAuth credentials
- `GOOGLE_CLIENT_SECRET` - From OAuth credentials
- `SESSION_SECRET` - Generate with `openssl rand -hex 32`

---

## Next Steps

After completing this setup:

1. ✅ Save your credentials securely
2. ✅ Add environment variables to backend `.env.production`
3. ✅ Verify redirect URI matches exactly
4. ✅ Test OAuth flow in development first
5. ✅ Deploy to production

---

**Last Updated:** November 2025
**Status:** ✅ Ready for Implementation

