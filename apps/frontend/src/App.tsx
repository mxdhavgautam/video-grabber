import { useState, useEffect } from 'react'
import { VideoGrabber } from './components/VideoGrabber'
import { Toaster } from './components/ui/toaster'
import { Button } from './components/ui/button'
import { Moon, Sun } from 'lucide-react'
import './index.css'

function App() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [isExtracting, setIsExtracting] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // Initialize theme from localStorage and system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'system' | null
    if (savedTheme) {
      setTheme(savedTheme)
    } else {
      // Check system preference
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setTheme(systemDark ? 'dark' : 'light')
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

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement
    let activeTheme = theme

    if (theme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      activeTheme = systemDark ? 'dark' : 'light'
    }

    if (activeTheme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }

    localStorage.setItem('theme', theme)
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      const root = document.documentElement
      if (e.matches) {
        root.classList.add('dark')
        root.classList.remove('light')
      } else {
        root.classList.add('light')
        root.classList.remove('dark')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
    setTheme(newTheme)
  }

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300 overflow-hidden">
      {/* Theme toggle - positioned absolutely in top-right */}
      <div className="fixed top-2 right-2 sm:top-4 sm:right-4 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg hover:bg-muted"
          title={`Switch to ${theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'} mode`}
          aria-label={`Current theme: ${theme}. Click to change.`}
        >
          {isDark ? <Sun className="h-4 w-4 sm:h-5 sm:w-5" /> : <Moon className="h-4 w-4 sm:h-5 sm:w-5" />}
        </Button>
      </div>

      {/* Main content container - fit to screen height */}
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

          {/* Single VideoGrabber Component - manages its own layout */}
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

