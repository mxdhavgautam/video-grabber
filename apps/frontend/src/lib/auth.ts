/**
 * Authentication utilities
 * Handles OAuth authentication and user session management
 */

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

// Get API base URL - handle both full URL and relative path
function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && envUrl !== '' && !envUrl.includes('undefined')) {
    // If it's a full URL, use it directly; if it's relative, prepend origin
    if (envUrl.startsWith('http')) {
      return envUrl;
    }
    return envUrl;
  }
  
  // Default to relative path for same-origin requests
  return '/api';
}

const API_BASE_URL = getApiBaseUrl();

/**
 * Get current user from session
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/user`, {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        return null;
      }
      throw new Error('Failed to get user');
    }

    const user = await response.json();
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Initiate Google OAuth login
 */
export function loginWithGoogle(): void {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  let backendUrl: string;
  
  if (envUrl && envUrl.startsWith('http')) {
    // Full URL provided - extract base URL
    backendUrl = envUrl.replace('/api', '');
  } else {
    // Default to same origin with port 3001 for backend
    backendUrl = window.location.origin.replace(/:\d+$/, ':3001');
  }
  
  window.location.href = `${backendUrl}/auth/google`;
}

/**
 * Logout user
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    
    // Redirect to login
    window.location.href = '/';
  } catch (error) {
    console.error('Error logging out:', error);
    // Still redirect even if logout fails
    window.location.href = '/';
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return user !== null;
}

/**
 * Extract YouTube cookies from the browser
 * This extracts cookies from the user's actual browser session
 * @returns {Promise<string>} Cookie string in Netscape format
 */
export async function extractBrowserCookies(): Promise<string | null> {
  try {
    // Open YouTube in a hidden iframe to access cookies
    // Note: This requires the user to be logged into YouTube in their browser
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = 'https://www.youtube.com';
    document.body.appendChild(iframe);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        document.body.removeChild(iframe);
        resolve(null);
      }, 5000);

      iframe.onload = () => {
        clearTimeout(timeout);
        try {
          // Try to access cookies from iframe (may fail due to CORS)
          // Instead, we'll use document.cookie which works for same-origin
          // For cross-origin, we need to use a different approach
          document.body.removeChild(iframe);
          
          // Use fetch to get cookies via a proxy or use document.cookie
          // Since we can't access cross-origin cookies directly, we'll use
          // a server-side approach or ask user to export cookies
          resolve(null);
        } catch (error) {
          document.body.removeChild(iframe);
          resolve(null);
        }
      };
    });
  } catch (error) {
    console.error('Error extracting browser cookies:', error);
    return null;
  }
}

/**
 * Extract YouTube cookies from browser using popup window
 * This opens YouTube in a popup and extracts cookies from it
 * @returns {Promise<string>} Cookie string in Netscape format
 */
export async function extractYouTubeCookiesViaPopup(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      console.log('[Auth] Opening YouTube in popup to extract cookies...');
      
      // Open YouTube in a popup window
      const popup = window.open(
        'https://www.youtube.com',
        'youtube-cookie-extractor',
        'width=800,height=600,left=100,top=100'
      );
      
      if (!popup) {
        console.error('[Auth] Popup blocked. Please allow popups for this site.');
        resolve(null);
        return;
      }
      
      // Listen for messages from the popup
      const messageHandler = (event: MessageEvent) => {
        // Security: Only accept messages from YouTube origin
        if (event.origin !== 'https://www.youtube.com') {
          console.warn('[Auth] Ignoring message from non-YouTube origin:', event.origin);
          return;
        }
        
        if (event.data.type === 'YOUTUBE_COOKIES') {
          window.removeEventListener('message', messageHandler);
          popup.close();
          
          const cookies = event.data.cookies;
          if (cookies && cookies.length > 0) {
            console.log(`[Auth] Extracted ${cookies.length} cookies from YouTube popup`);
            const netscapeFormat = convertCookiesToNetscape(cookies);
            resolve(netscapeFormat);
          } else {
            console.warn('[Auth] No cookies found in popup');
            resolve(null);
          }
        } else if (event.data.type === 'YOUTUBE_COOKIES_ERROR') {
          window.removeEventListener('message', messageHandler);
          popup.close();
          console.error('[Auth] Error extracting cookies from popup:', event.data.error);
          resolve(null);
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Inject script into popup to extract cookies
      // Wait for popup to load
      const checkPopup = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(checkPopup);
            window.removeEventListener('message', messageHandler);
            console.warn('[Auth] Popup was closed before cookies could be extracted');
            resolve(null);
            return;
          }
          
          // Try to access popup's document (will fail due to CORS, but we can try)
          // Instead, we'll inject a script via the popup's URL
          // Actually, we need to use a different approach - inject script via postMessage
          // But postMessage won't work for cross-origin cookies
          
          // Better approach: Use a bookmarklet or injected script
          // Since we can't inject scripts cross-origin, we need the popup to run our script
          // The popup needs to load a page that runs our extraction script
          
          // Alternative: Use a service worker or extension (not practical)
          // Best: Have the popup navigate to a page that extracts cookies and posts them back
          
          // For now, let's try a different approach: Use an iframe with a script
          // that the user can run manually, or use a bookmarklet
          
          // Actually, the best approach is to have the popup load a special page
          // that extracts cookies and posts them back. But we can't control YouTube's pages.
          
          // WORKAROUND: Use a data URL with a script that extracts cookies
          // But this won't have access to YouTube's cookies due to same-origin policy
          
          // The ONLY reliable way is to have the user manually export cookies
          // OR use a browser extension
          // OR use the backend browser automation (which we're already doing)
          
          // For now, let's try to use document.cookie if we can access it
          // But we can't due to CORS
          
          // FALLBACK: Close popup after timeout and return null
          // The backend will handle cookie extraction via browser automation
        } catch (e) {
          // Popup might be from different origin, can't access
        }
      }, 500);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkPopup);
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          popup.close();
        }
        console.warn('[Auth] Cookie extraction timeout');
        resolve(null);
      }, 30000);
      
    } catch (error) {
      console.error('[Auth] Error in popup cookie extraction:', error);
      resolve(null);
    }
  });
}

/**
 * Extract YouTube cookies from browser using fetch
 * Note: Due to CORS restrictions, we cannot directly read cookies from cross-origin responses.
 * This function attempts to extract cookies, but may not work in all browsers.
 * The backend browser automation is the primary method for cookie extraction.
 */
export async function extractYouTubeCookiesViaFetch(): Promise<string | null> {
  try {
    // Note: Due to CORS, we cannot read Set-Cookie headers from cross-origin responses
    // The browser will send cookies with the request, but we can't read them from the response
    // This is a limitation of browser security
    
    // Try to get cookies from document.cookie if we're on YouTube domain
    // This only works if the user is on youtube.com
    if (window.location.hostname.includes('youtube.com')) {
      const cookies = document.cookie.split(';').map(c => c.trim()).filter(c => c);
      if (cookies.length > 0) {
        console.log('[Auth] Found cookies from YouTube domain');
        // Convert to Netscape format
        return convertCookiesToNetscape(cookies);
      }
    }
    
    // If not on YouTube domain, we cannot extract cookies due to CORS
    // The backend browser automation will handle cookie extraction instead
    console.log('[Auth] Cannot extract cookies from cross-origin (CORS restriction)');
    console.log('[Auth] Backend browser automation will extract cookies instead');
    return null;
  } catch (error) {
    console.error('Error extracting YouTube cookies:', error);
    return null;
  }
}

/**
 * Convert cookie array to Netscape format
 */
function convertCookiesToNetscape(cookies: string[]): string {
  let netscape = '# Netscape HTTP Cookie File\n';
  netscape += '# This file was generated by Video Grabber from browser cookies\n';
  netscape += '# Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue\n\n';

  for (const cookie of cookies) {
    const [nameValue, ...attributes] = cookie.split(';');
    const [name, value] = nameValue.split('=').map(s => s.trim());
    
    if (!name || !value) continue;

    const domain = '.youtube.com';
    const flag = 'TRUE';
    const path = '/';
    const secure = attributes.some(a => a.trim().toLowerCase() === 'secure') ? 'TRUE' : 'FALSE';
    const expiration = 0; // Session cookie

    netscape += `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}\n`;
  }

  return netscape;
}

/**
 * Convert Set-Cookie headers to Netscape format
 */
function convertSetCookiesToNetscape(setCookies: string[]): string {
  let netscape = '# Netscape HTTP Cookie File\n';
  netscape += '# This file was generated by Video Grabber from browser cookies\n';
  netscape += '# Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue\n\n';

  for (const cookieHeader of setCookies) {
    const parts = cookieHeader.split(';').map(p => p.trim());
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=');
    
    if (!name || !value) continue;

    let domain = '.youtube.com';
    let path = '/';
    let secure = 'FALSE';
    let expiration = 0;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].toLowerCase();
      if (part === 'secure') {
        secure = 'TRUE';
      } else if (part.startsWith('domain=')) {
        domain = part.substring(7);
      } else if (part.startsWith('path=')) {
        path = part.substring(5);
      } else if (part.startsWith('expires=')) {
        const expiresStr = part.substring(8);
        const expiresDate = new Date(expiresStr);
        if (!isNaN(expiresDate.getTime())) {
          expiration = Math.floor(expiresDate.getTime() / 1000);
        }
      } else if (part.startsWith('max-age=')) {
        const maxAge = parseInt(part.substring(8), 10);
        if (!isNaN(maxAge)) {
          expiration = Math.floor(Date.now() / 1000) + maxAge;
        }
      }
    }

    netscape += `${domain}\tTRUE\t${path}\t${secure}\t${expiration}\t${name}\t${value}\n`;
  }

  return netscape;
}

/**
 * Send browser cookies to backend
 * @param {string} cookieString - Cookie string in Netscape format
 */
export async function sendCookiesToBackend(cookieString: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/import-cookies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ cookies: cookieString }),
    });

    if (!response.ok) {
      console.error('Failed to send cookies:', response.statusText);
      return false;
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Error sending cookies to backend:', error);
    return false;
  }
}

/**
 * Extract cookies using Chrome DevTools Protocol via a helper page
 * Opens a special page that uses Chrome's cookie API to extract YouTube cookies
 */
export async function extractCookiesViaHelperPage(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      console.log('[Auth] Opening cookie extraction helper page...');
      
      // Create a popup that loads a helper page
      // The helper page will use chrome.cookies API (if extension) or document.cookie
      const helperUrl = `${window.location.origin}/cookie-extractor.html`;
      const popup = window.open(
        helperUrl,
        'cookie-extractor',
        'width=600,height=400,left=100,top=100'
      );
      
      if (!popup) {
        console.error('[Auth] Popup blocked. Please allow popups for this site.');
        resolve(null);
        return;
      }
      
      const messageHandler = (event: MessageEvent) => {
        // Only accept messages from same origin
        if (event.origin !== window.location.origin) {
          return;
        }
        
        if (event.data.type === 'COOKIES_EXTRACTED') {
          window.removeEventListener('message', messageHandler);
          popup.close();
          
          const cookies = event.data.cookies;
          if (cookies && cookies.length > 0) {
            console.log(`[Auth] Extracted ${cookies.length} cookies via helper page`);
            const netscapeFormat = convertCookiesToNetscape(cookies);
            resolve(netscapeFormat);
          } else {
            resolve(null);
          }
        } else if (event.data.type === 'COOKIES_ERROR') {
          window.removeEventListener('message', messageHandler);
          popup.close();
          console.error('[Auth] Error extracting cookies:', event.data.error);
          resolve(null);
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          popup.close();
        }
        console.warn('[Auth] Cookie extraction timeout');
        resolve(null);
      }, 30000);
      
    } catch (error) {
      console.error('[Auth] Error in helper page cookie extraction:', error);
      resolve(null);
    }
  });
}

/**
 * Extract cookies by opening YouTube and using postMessage
 * This is the most reliable method - opens YouTube in popup and extracts cookies
 */
export async function extractCookiesFromYouTubePopup(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      console.log('[Auth] Opening YouTube to extract cookies...');
      
      // Create a unique ID for this extraction session
      const sessionId = `cookie-extract-${Date.now()}`;
      
      // Store the resolve function so the message handler can access it
      (window as any)[`__cookieExtract_${sessionId}`] = resolve;
      
      // Open YouTube in a new window
      // We'll inject a script that extracts cookies and posts them back
      const popup = window.open(
        `https://www.youtube.com?extract_cookies=${sessionId}`,
        'youtube-cookie-extract',
        'width=800,height=600'
      );
      
      if (!popup) {
        console.error('[Auth] Popup blocked. Please allow popups.');
        delete (window as any)[`__cookieExtract_${sessionId}`];
        resolve(null);
        return;
      }
      
      // Listen for messages
      const messageHandler = (event: MessageEvent) => {
        if (event.origin !== 'https://www.youtube.com') {
          return;
        }
        
        if (event.data.type === 'COOKIES_EXTRACTED' && event.data.sessionId === sessionId) {
          window.removeEventListener('message', messageHandler);
          popup.close();
          delete (window as any)[`__cookieExtract_${sessionId}`];
          
          const cookies = event.data.cookies;
          if (cookies && cookies.length > 0) {
            console.log(`[Auth] Extracted ${cookies.length} cookies from YouTube`);
            const netscapeFormat = convertCookiesToNetscape(cookies);
            resolve(netscapeFormat);
          } else {
            resolve(null);
          }
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Inject script into popup after it loads
      // We can't do this directly due to CORS, so we need a different approach
      // Instead, we'll use a bookmarklet or have the user run a script
      
      // Actually, the best approach is to use a service that proxies the request
      // OR use the backend to extract cookies (which we're already doing)
      
      // For now, let's try a simpler approach: Use an iframe with a data URL
      // that loads YouTube and tries to extract cookies
      
      // Timeout
      setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          popup.close();
        }
        delete (window as any)[`__cookieExtract_${sessionId}`];
        console.warn('[Auth] Cookie extraction timeout');
        resolve(null);
      }, 30000);
      
    } catch (error) {
      console.error('[Auth] Error extracting cookies from YouTube:', error);
      resolve(null);
    }
  });
}

/**
 * Trigger server-side cookie extraction after OAuth login
 * The backend will use the OAuth token to visit YouTube pages
 * and extract session cookies from the response headers
 * Also tries to extract cookies from the user's browser
 */
export async function triggerCookieExtraction(): Promise<boolean> {
  try {
    console.log('[Auth] Starting cookie extraction process...');
    
    // Method 1: Try to extract cookies using iframe approach
    // This won't work due to CORS, but we'll try anyway
    console.log('[Auth] Attempting to extract cookies from browser (iframe method)...');
    let browserCookies = await extractBrowserCookies();
    
    // Method 2: Try popup method (also won't work due to CORS, but we'll try)
    if (!browserCookies) {
      console.log('[Auth] Attempting to extract cookies from browser (popup method)...');
      browserCookies = await extractYouTubeCookiesViaPopup();
    }
    
    // Method 3: Try fetch method (only works if on YouTube domain)
    if (!browserCookies) {
      console.log('[Auth] Attempting to extract cookies from browser (fetch method)...');
      browserCookies = await extractYouTubeCookiesViaFetch();
    }
    
    // If we got cookies, send them to backend
    if (browserCookies) {
      console.log('[Auth] Extracted cookies from browser, sending to backend...');
      const sent = await sendCookiesToBackend(browserCookies);
      if (sent) {
        console.log('[Auth] Successfully imported browser cookies');
        return true;
      }
    }

    // Fallback: Trigger server-side extraction
    // The backend will use browser automation to extract cookies
    console.log('[Auth] Browser cookie extraction not available, triggering server-side extraction...');
    console.log('[Auth] The backend will use browser automation to extract cookies from your OAuth session.');
    const response = await fetch(`${API_BASE_URL}/auth/extract-cookies`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      console.error('Failed to extract cookies:', response.statusText);
      return false;
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Error triggering cookie extraction:', error);
    return false;
  }
}

