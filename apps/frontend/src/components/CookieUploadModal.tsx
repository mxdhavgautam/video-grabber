import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

interface CookieUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiBaseUrl: string;
}

export function CookieUploadModal({ open, onOpenChange, apiBaseUrl }: CookieUploadModalProps) {
  const [cookiesText, setCookiesText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleUpload = async () => {
    if (!cookiesText.trim()) {
      toast({
        title: 'Error',
        description: 'Please paste your cookies.txt content',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/upload-authenticated-cookies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: cookiesText,
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Uploaded ${data.cookieCount} cookies successfully`,
        });
        setCookiesText('');
        onOpenChange(false);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Cookie upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload cookies',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleClear = () => {
    setCookiesText('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Upload YouTube Cookies</DialogTitle>
          <DialogDescription>
            Paste your YouTube cookies.txt content below to enable downloading age-restricted and
            members-only content. This helps bypass bot detection.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="cookies">Cookies.txt Content</Label>
            <textarea
              id="cookies"
              className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	1234567890	VISITOR_INFO1_LIVE	...&#10;.youtube.com	TRUE	/	FALSE	1234567890	CONSENT	...&#10;..."
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground">
              Export cookies from your browser using an extension like "Get cookies.txt LOCALLY".
              Make sure to export from a private/incognito window for best results.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
              ⚠️ Important Notes:
            </h4>
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
              <li>Export cookies from a private/incognito browsing session</li>
              <li>Close the private window immediately after exporting</li>
              <li>Never share your cookies with anyone else</li>
              <li>Using your account may risk temporary or permanent bans</li>
              <li>Only use for content you have legitimate access to</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={isUploading || !cookiesText}
          >
            Clear
          </Button>
          <Button onClick={handleUpload} disabled={isUploading || !cookiesText.trim()}>
            {isUploading ? 'Uploading...' : 'Upload Cookies'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

