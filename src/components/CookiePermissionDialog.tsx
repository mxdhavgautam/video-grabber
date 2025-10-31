import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'

interface CookiePermissionDialogProps {
  isOpen: boolean
  onAllow: () => void
  onDeny: () => void
  isLoading?: boolean
}

export function CookiePermissionDialog({
  isOpen,
  onAllow,
  onDeny,
  isLoading = false,
}: CookiePermissionDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && !isLoading) {
        onDeny()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-600" />
            <DialogTitle>Enable Automatic Cookie Access?</DialogTitle>
          </div>
        </DialogHeader>
        <DialogDescription className="sr-only">
          Allow this app to read your YouTube login cookies from your Chrome browser to bypass YouTube's bot detection.
        </DialogDescription>
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">
            Allow this app to read your YouTube login cookies from your Chrome browser to bypass YouTube's bot detection.
          </div>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-green-600 font-bold mt-0.5">✓</span>
              <span><strong>One-time approval:</strong> macOS will ask for Keychain permission (normal security check)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600 font-bold mt-0.5">✓</span>
              <span><strong>Session-only:</strong> Your cookies are sent to our server, used for that download, then immediately deleted</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600 font-bold mt-0.5">✓</span>
              <span><strong>Bot detection only:</strong> Cookies bypass YouTube's anti-bot checks - nothing else</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600 font-bold mt-0.5">✓</span>
              <span><strong>Open source:</strong> Check our code on <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">GitHub</a> if you want to verify what we do with your cookies</span>
            </div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded p-2.5 space-y-1.5">
            <div className="text-xs font-medium text-blue-900 dark:text-blue-100 flex items-start gap-2">
              <span>ℹ️</span>
              <span><strong>macOS Keychain:</strong> The popup asking for your "login" keychain password is macOS protecting your stored passwords. We're just reading what's already saved in Chrome. Click "Always Allow" for convenience.</span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onDeny}
            disabled={isLoading}
          >
            Deny
          </Button>
          <Button
            onClick={onAllow}
            disabled={isLoading}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isLoading ? 'Uploading...' : 'Allow & Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
