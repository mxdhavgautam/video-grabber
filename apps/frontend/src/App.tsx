import { useState, useEffect } from 'react'
import { VideoGrabber } from './components/VideoGrabber'
import { LoginScreen } from './components/LoginScreen'
import { Toaster } from './components/ui/toaster'
import { Button } from './components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Moon, Sun, Monitor, LogOut, User } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import { triggerCookieExtraction } from './lib/auth'
import './index.css'

function App() {
  const { user, isLoading, isAuthenticated, logout } = useAuth()
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [isExtracting, setIsExtracting] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // Initialize theme from localStorage and system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'system' | null
    if (savedTheme) {
      setTheme(savedTheme)
    } else {
      // Default to system preference
      setTheme('system')
    }
  }, [])

  // Detect mobile breakpoint
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Apply theme to DOM with proper system preference detection
  useEffect(() => {
    const root = document.documentElement
    let activeTheme = theme

    if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      activeTheme = systemDark ? 'dark' : 'light'
    }

    // Remove all theme classes first
    root.classList.remove('light', 'dark')
    
    // Add the active theme class
    root.classList.add(activeTheme)
    
    // Store the preference (not the computed theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Listen for system theme changes when theme is set to 'system'
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      if (e.matches) {
        root.classList.add('dark')
      } else {
        root.classList.add('light')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  // Check for auth success in URL params and trigger cookie extraction
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'success') {
      // Remove auth param from URL
      window.history.replaceState({}, '', window.location.pathname)
      
      // Trigger cookie extraction from browser
      // This will try to extract cookies from the user's browser and send to backend
      triggerCookieExtraction().then((success) => {
        if (success) {
          console.log('[App] Cookie extraction successful')
        } else {
          console.warn('[App] Cookie extraction failed, will retry on next extraction')
        }
        // Refresh auth state after cookie extraction attempt
        window.location.reload()
      }).catch((error) => {
        console.error('[App] Error during cookie extraction:', error)
        // Still reload even if cookie extraction fails
        window.location.reload()
      })
    }
  }, [])

  const getActiveTheme = () => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme
  }

  const isDark = getActiveTheme() === 'dark'

  // Show login screen if not authenticated
  if (!isLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
        <LoginScreen />
        <Toaster />
      </div>
    )
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Main app for authenticated users
  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300 overflow-hidden">
      {/* Top bar with theme toggle and user menu */}
      <div className="fixed top-2 right-2 sm:top-4 sm:right-4 z-50 flex items-center gap-2">
        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg hover:bg-muted"
              title={`Current theme: ${theme}. Click to change.`}
            >
              {theme === 'system' ? (
                <Monitor className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : isDark ? (
                <Sun className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : (
                <Moon className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg hover:bg-muted"
            >
              <Avatar className="h-8 w-8">
                {user?.picture && <AvatarImage src={user.picture} alt={user.name || 'User'} />}
                <AvatarFallback>
                  {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main content container */}
      <div className="flex flex-col h-screen px-8 py-32 sm:px-4 sm:py-4 transition-all duration-500 ease-out">
        {/* Combined Header & Input Section */}
        <div className={`w-full max-w-2xl mx-auto transition-all duration-500 ease-out ${
          isExtracting 
            ? 'py-1 sm:py-2 mb-1 sm:mb-2' 
            : 'py-0 sm:py-52 flex-0'
        }`}>
          {/* Title & Subtitle - Hidden on mobile when extracting */}
          {(!isExtracting || !isMobile) && (
            <div className="mb-12 sm:mb-6 text-center">
              <h1 className={`font-bold text-center bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent leading-tight transition-all duration-300 ${
                isExtracting ? 'text-2xl sm:text-3xl mb-0.5' : 'text-5xl sm:text-5xl mb-1 sm:mb-2'
              }`}>
                Video Grabber
              </h1>
              <p className={`text-muted-foreground text-center max-w-md mx-auto transition-all duration-300 ${
                isExtracting ? 'text-xs sm:text-sm opacity-60 leading-tight' : 'text-sm sm:text-sm opacity-100'
              }`}>
                Download YouTube videos in any format
              </p>
            </div>
          )}

          {/* Single VideoGrabber Component */}
          <main className="w-full transition-all duration-500 ease-out">
            <VideoGrabber onExtracting={setIsExtracting} />
          </main>
        </div>
      </div>

      <Toaster />
    </div>
  )
}

export default App
