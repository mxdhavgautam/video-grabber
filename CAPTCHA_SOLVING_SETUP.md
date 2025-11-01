# Self-Hosted Open-Source CAPTCHA Solving

This document describes the self-hosted, open-source CAPTCHA solving capabilities integrated into the cookie generator service.

## Overview

The system includes **completely free, self-hosted** CAPTCHA solving capabilities using open-source OCR libraries:

1. **Stealth Plugin**: Uses `puppeteer-extra-plugin-stealth` to reduce bot detection
2. **Self-Hosted OCR**: Uses `ddddocr` and `pytesseract` for image/text CAPTCHA solving
3. **CAPTCHA Detection**: Automatically detects various CAPTCHA types
4. **YouTube Challenge Handling**: Special handling for YouTube's bot detection challenges

## Features

### 1. Stealth Plugin
- **Library**: `puppeteer-extra-plugin-stealth`
- **Purpose**: Makes Puppeteer browsers less detectable
- **Benefits**: Reduces likelihood of CAPTCHAs appearing
- **Status**: Always enabled (no configuration needed)

### 2. Self-Hosted CAPTCHA Solving

#### Libraries Used
- **ddddocr**: Popular open-source CAPTCHA solver (works well for many CAPTCHA types)
  - GitHub: https://github.com/sml2h3/ddddocr
  - Works for: Simple text, number, letter CAPTCHAs, many Chinese CAPTCHAs
  - Success rate: Good for simple CAPTCHAs (60-90% depending on complexity)

- **pytesseract**: Tesseract OCR wrapper for text recognition
  - Uses: Google's Tesseract OCR engine
  - Works for: Text-based CAPTCHAs with clear characters
  - Success rate: Moderate for clear text (40-70%)

- **Pillow**: Image processing library
  - Used for: Image preprocessing (contrast, resizing) to improve OCR accuracy

#### What It Can Solve
✅ **Simple Image/Text CAPTCHAs**: 
   - Text CAPTCHAs (letters and numbers)
   - Number-only CAPTCHAs
   - Simple distorted text
   - Some math CAPTCHAs (if text is clear)

❌ **What It Cannot Solve**:
   - **reCAPTCHA v2/v3**: Requires browser interactions and Google API
   - **hCaptcha**: Requires clicking specific images (complex computer vision)
   - **Cloudflare Turnstile**: Behavioral challenge, not image-based
   - **Image Selection Challenges**: "Click all images with traffic lights" (requires AI/ML models)
   - **Audio CAPTCHAs**: Would require speech recognition

### 3. CAPTCHA Detection
Automatically detects:
- **Simple Image/Text CAPTCHAs**: Can be solved with OCR
- **reCAPTCHA v2/v3**: Detected but cannot be fully solved
- **hCaptcha**: Detected but cannot be solved
- **Cloudflare Turnstile**: Detected but cannot be solved
- **YouTube Challenge**: YouTube-specific bot detection (handled via natural browsing)

### 4. YouTube Challenge Handling

YouTube uses behavioral challenges rather than standard CAPTCHAs. The system:
- Detects YouTube challenge pages
- Interacts with challenge elements when possible
- Continues natural browsing to build trust
- Waits for challenge to resolve automatically
- **No API costs**: Handled entirely through browser automation

## Installation

The CAPTCHA solving libraries are automatically installed in the Docker image:

```dockerfile
# Install Tesseract OCR engine
tesseract-ocr libtesseract-dev

# Install Python libraries
ddddocr pytesseract pillow
```

No configuration needed - libraries are installed during Docker build.

## How It Works

### Detection Flow

1. **Page Load**: After visiting YouTube or other sites
2. **CAPTCHA Check**: Automatically scans for CAPTCHA elements
3. **Type Detection**: Identifies CAPTCHA type (simple image, reCAPTCHA, etc.)
4. **Solving**: If simple image CAPTCHA, extracts image and solves with OCR
5. **Injection**: Injects solution text into page input fields
6. **Verification**: Waits for page to update

### Simple CAPTCHA Solving Flow

1. **Extraction**: Finds CAPTCHA image on page
2. **Screenshot**: Captures image element
3. **Preprocessing**: Enhances contrast, resizes if needed (Pillow)
4. **OCR**: Runs ddddocr or pytesseract to extract text
5. **Injection**: Fills solution into input field
6. **Submission**: Clicks submit button if available

### YouTube Challenge Flow

1. **Detection**: Detects "Sign in to confirm" or bot detection messages
2. **Interaction**: Clicks challenge checkboxes/interacts with elements
3. **Natural Browsing**: Continues human-like behavior (typing, scrolling)
4. **Resolution**: Challenge usually resolves automatically through behavior

## Integration Points

### Cookie Generator
- Detects CAPTCHAs after page loads
- Automatically solves simple CAPTCHAs when detected
- Handles YouTube-specific challenges
- Logs all CAPTCHA events for debugging

### Logging

The system logs:
- CAPTCHA detection events
- Solver used (ddddocr or pytesseract)
- Solution success/failure
- YouTube challenge handling attempts

Example logs:
```
[CaptchaSolver] ✓ Using self-hosted open-source CAPTCHA solver (free)
[CaptchaSolver] Detected CAPTCHA type: simple-image-captcha
[SelfHostedCaptchaSolver] ddddocr solution: ABC123
[CaptchaSolver] ✓ Simple CAPTCHA solved with self-hosted OCR
```

## Limitations & Workarounds

### reCAPTCHA v2/v3
**Cannot solve** - Requires:
- Browser fingerprinting
- Mouse movement tracking
- Image selection (requires trained ML models)
- Google's API tokens

**Workaround**: 
- The system attempts to click reCAPTCHA checkbox
- If image challenge appears, it cannot be solved automatically
- May need manual intervention or accept that some sites are not accessible

### hCaptcha
**Cannot solve** - Requires:
- Clicking specific images ("Select all squares with bicycles")
- Complex computer vision models
- Behavioral analysis

**Workaround**: Same as reCAPTCHA - basic interaction only

### YouTube Challenges
**Can handle** - YouTube's challenges are behavioral:
- Solved through natural browsing patterns
- Human-like typing, scrolling, delays
- Building browsing history and trust
- **No cost** - handled entirely via automation

### Simple CAPTCHAs
**Can solve** - Works well for:
- Text-based CAPTCHAs with clear characters
- Number-only CAPTCHAs
- Simple distorted text (moderate success)

## Best Practices

1. **Focus on Simple CAPTCHAs**: Self-hosted solver works best for basic text/number CAPTCHAs
2. **Natural Browsing**: For YouTube and behavioral challenges, continue natural browsing
3. **Error Handling**: System gracefully handles unsolvable CAPTCHAs
4. **Logging**: Monitor logs to see which CAPTCHAs can/cannot be solved
5. **Cookie Quality**: Better cookies (VISITOR_INFO1_LIVE) = fewer CAPTCHAs

## Troubleshooting

### CAPTCHAs Not Being Solved
- Check if CAPTCHA type is supported (simple image/text only)
- Verify libraries are installed: `python3 -c "import ddddocr; import pytesseract"`
- Check logs for OCR errors
- Simple CAPTCHAs: Should work
- reCAPTCHA/hCaptcha: Cannot be solved automatically

### Low Success Rate
- **ddddocr**: Try different CAPTCHA types, works better for some than others
- **pytesseract**: Preprocessing (contrast, resizing) helps improve accuracy
- Some CAPTCHAs are too distorted/fragmented for OCR

### YouTube Challenges Persist
- This is normal - YouTube uses behavioral analysis
- Continue natural browsing (system handles this automatically)
- Ensure cookies are being generated (VISITOR_INFO1_LIVE)
- Browser restarts every 12 hours help reset reputation

## Cost

**100% Free** - No API keys, no external services, no costs.

- Libraries are open-source
- Runs entirely on your server
- No rate limits (only your server resources)
- No per-CAPTCHA charges

## Future Enhancements

Potential improvements:
- Train custom ML models for specific CAPTCHA types
- Integrate audio CAPTCHA solving (speech recognition)
- Advanced image preprocessing techniques
- Support for more CAPTCHA variations

## Summary

This is a **completely free, self-hosted** CAPTCHA solving solution that works well for:
- ✅ Simple text/number CAPTCHAs
- ✅ YouTube behavioral challenges (via natural browsing)
- ❌ Complex CAPTCHAs (reCAPTCHA, hCaptcha) require commercial services or manual solving

The system is designed to automatically handle what it can and gracefully skip what it cannot, keeping your automation running smoothly.
