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
 * Trigger server-side cookie extraction after OAuth login
 * The backend will use the OAuth token to visit YouTube pages
 * and extract session cookies from the response headers
 * Also tries to extract cookies from the user's browser
 */
export async function triggerCookieExtraction(): Promise<boolean> {
  try {
    // First, try to extract cookies from browser
    console.log('[Auth] Attempting to extract cookies from browser...');
    const browserCookies = await extractYouTubeCookiesViaFetch();
    
    if (browserCookies) {
      console.log('[Auth] Extracted cookies from browser, sending to backend...');
      const sent = await sendCookiesToBackend(browserCookies);
      if (sent) {
        console.log('[Auth] Successfully imported browser cookies');
        return true;
      }
    }

    // Fallback: Trigger server-side extraction
    console.log('[Auth] Falling back to server-side cookie extraction...');
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

