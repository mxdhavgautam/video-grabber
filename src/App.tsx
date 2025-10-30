import { VideoGrabber } from './components/VideoGrabber'
import { Toaster } from './components/ui/toaster'
import './index.css'

function App() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-4 sm:py-8 max-w-4xl">
        <header className="mb-6 sm:mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Video Grabber
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground px-2">
            Download videos from YouTube in various formats and qualities
          </p>
        </header>
        <VideoGrabber />
      </div>
      <Toaster />
    </div>
  )
}

export default App

