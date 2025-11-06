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
 * Trigger server-side cookie extraction after OAuth login
 * The backend will use the OAuth token to visit YouTube pages
 * and extract session cookies from the response headers
 */
export async function triggerCookieExtraction(): Promise<boolean> {
  try {
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

