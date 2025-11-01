/**
 * CAPTCHA Solver Service
 * 
 * Self-hosted open-source CAPTCHA solving using:
 * - ddddocr: Popular open-source CAPTCHA solver (works well for many types)
 * - pytesseract: Tesseract OCR wrapper for text recognition
 * 
 * Limitations:
 * - Simple image/text CAPTCHAs: Good success rate
 * - reCAPTCHA v2/v3: Cannot solve (requires browser interactions)
 * - hCaptcha: Cannot solve (requires clicking specific images)
 * - YouTube challenges: Behavioral, not image-based (handled via natural browsing)
 */

class CaptchaSolver {
  constructor() {
    // Initialize self-hosted solver (open-source, free)
    this.selfHostedSolver = null;
    this.initSelfHostedSolver();
    
    if (this.selfHostedSolver && (this.selfHostedSolver.ddddocrAvailable || this.selfHostedSolver.pytesseractAvailable)) {
      console.log('[CaptchaSolver] ✓ Using self-hosted open-source CAPTCHA solver (free)');
      console.log('[CaptchaSolver] Libraries: ddddocr, pytesseract');
      console.log('[CaptchaSolver] Note: Limited to simple image/text CAPTCHAs');
    } else {
      console.log('[CaptchaSolver] Self-hosted solver not fully available');
      console.log('[CaptchaSolver] Libraries should be installed in Docker (ddddocr, pytesseract, tesseract-ocr)');
    }
  }

  /**
   * Initialize self-hosted CAPTCHA solver
   */
  async initSelfHostedSolver() {
    try {
      const SelfHostedCaptchaSolver = (await import('./self-hosted-captcha-solver.mjs')).default;
      this.selfHostedSolver = new SelfHostedCaptchaSolver();
    } catch (error) {
      console.log('[CaptchaSolver] Self-hosted solver not available:', error.message);
      this.selfHostedSolver = null;
    }
  }

  /**
   * Detect if page contains a CAPTCHA challenge
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<Object>} CAPTCHA detection result
   */
  async detectCaptcha(page) {
    try {
      // Check for reCAPTCHA
      const hasRecaptcha = await page.evaluate(() => {
        // Check for reCAPTCHA v2
        if (document.querySelector('.g-recaptcha') || 
            document.querySelector('#recaptcha') ||
            window.grecaptcha) {
          return { type: 'recaptcha-v2', found: true };
        }
        
        // Check for reCAPTCHA v3 (usually invisible, check for challenge)
        if (window.grecaptcha && window.grecaptcha.getResponse) {
          const response = window.grecaptcha.getResponse();
          if (!response || response.length === 0) {
            return { type: 'recaptcha-v3', found: true };
          }
        }
        
        // Check for hCaptcha
        if (document.querySelector('.h-captcha') ||
            document.querySelector('[data-sitekey]')) {
          return { type: 'hcaptcha', found: true };
        }
        
        // Check for Cloudflare Turnstile
        if (document.querySelector('.cf-turnstile') ||
            document.querySelector('[data-sitekey]')) {
          return { type: 'turnstile', found: true };
        }
        
        // Check for YouTube bot detection
        const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
        if (bodyText.includes('sign in to confirm you') ||
            bodyText.includes('not a bot') ||
            bodyText.includes('verify you') ||
            bodyText.includes('unusual traffic')) {
          return { type: 'youtube-challenge', found: true };
        }
        
        // Check for simple image/text CAPTCHAs (can be solved with OCR)
        const simpleCaptchaImg = document.querySelector('img[alt*="captcha" i], img[src*="captcha" i], .captcha img, img[src*="code" i], input[type="text"][name*="captcha" i]');
        if (simpleCaptchaImg) {
          return { type: 'simple-image-captcha', found: true };
        }
        
        return { found: false };
      });
      
      if (hasRecaptcha && hasRecaptcha.found) {
        console.log(`[CaptchaSolver] Detected CAPTCHA type: ${hasRecaptcha.type}`);
        return hasRecaptcha;
      }
      
      return { found: false };
    } catch (error) {
      console.warn('[CaptchaSolver] Error detecting CAPTCHA:', error.message);
      return { found: false };
    }
  }

  /**
   * Solve simple image/text CAPTCHA using self-hosted OCR
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<string|null>} Solution text or null
   */
  async solveSimpleCaptcha(page) {
    if (!this.selfHostedSolver) {
      console.log('[CaptchaSolver] Self-hosted solver not available');
      return null;
    }

    try {
      console.log('[CaptchaSolver] Attempting to solve simple CAPTCHA with self-hosted OCR...');
      const solution = await this.selfHostedSolver.solveCaptchaFromPage(page);
      
      if (solution) {
        console.log(`[CaptchaSolver] ✓ Self-hosted solver solution: ${solution}`);
        
        // Try to inject solution into common CAPTCHA input fields
        await page.evaluate((sol) => {
          const inputs = document.querySelectorAll('input[type="text"], input[name*="captcha" i], input[id*="captcha" i], input[name*="code" i]');
          if (inputs.length > 0) {
            inputs[0].value = sol;
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, solution);
        
        return solution;
      }
    } catch (error) {
      console.warn('[CaptchaSolver] Simple CAPTCHA solving error:', error.message);
    }

    return null;
  }

  /**
   * Attempt to solve reCAPTCHA v2 (limited support)
   * Note: reCAPTCHA v2/v3 cannot be fully solved with self-hosted OCR
   * They require browser interactions and Google's API
   * This method will only attempt to interact with checkboxes if available
   */
  async solveRecaptchaV2(page, siteKey = null) {
    console.warn('[CaptchaSolver] reCAPTCHA v2/v3 cannot be solved with self-hosted OCR');
    console.warn('[CaptchaSolver] reCAPTCHA requires browser interactions and Google API');
    console.warn('[CaptchaSolver] Attempting checkbox interaction...');
    
    try {
      // Try to click reCAPTCHA checkbox if available
      const checkbox = await page.$('.g-recaptcha iframe') || 
                       await page.$('#recaptcha') ||
                       await page.$('[data-sitekey]');
      
      if (checkbox) {
        console.log('[CaptchaSolver] Found reCAPTCHA element, clicking...');
        await checkbox.click();
        await this.sleep(5000); // Wait for challenge to appear/resolve
        
        // Check if challenge appeared (image selection)
        const challengeImages = await page.$('.rc-imageselect');
        if (challengeImages) {
          console.warn('[CaptchaSolver] Image selection challenge appeared - cannot solve automatically');
          console.warn('[CaptchaSolver] Self-hosted solver cannot solve image selection challenges');
        }
        
        return 'interacted'; // Indicate we tried
      }
    } catch (error) {
      console.warn('[CaptchaSolver] reCAPTCHA interaction error:', error.message);
    }
    
    return null;
  }

  /**
   * Handle YouTube bot detection challenge
   * This is more complex - YouTube doesn't use standard reCAPTCHA
   * We can try to wait and let the user browse naturally, or use human verification
   */
  async handleYouTubeChallenge(page) {
    console.log('[CaptchaSolver] Detected YouTube bot detection challenge');
    console.log('[CaptchaSolver] Strategy: Continue browsing naturally to build trust');
    
    // YouTube's challenge is usually behavioral - continue normal browsing
    // The challenge will resolve itself if behavior appears human-like
    // We already have human-like typing, scrolling, delays, etc.
    
    // Sometimes clicking "I'm not a robot" checkbox helps
    try {
      const checkboxSelectors = [
        'input[type="checkbox"]',
        '.rc-anchor-checkbox',
        '[aria-label*="robot"]',
        '[aria-label*="I\'m not a robot"]',
        'iframe[src*="recaptcha"]'
      ];
      
      for (const selector of checkboxSelectors) {
        try {
          const checkbox = await page.$(selector);
          if (checkbox) {
            console.log(`[CaptchaSolver] Found challenge element with ${selector}, interacting...`);
            await checkbox.click();
            await this.sleep(2000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Also try to interact with any visible iframe
      try {
        const iframes = await page.$$('iframe');
        for (const iframe of iframes.slice(0, 3)) {
          const src = await page.evaluate(el => el.src, iframe);
          if (src.includes('recaptcha') || src.includes('challenge')) {
            console.log('[CaptchaSolver] Found CAPTCHA iframe, attempting interaction...');
            await iframe.click();
            await this.sleep(1000);
          }
        }
      } catch (iframeError) {
        // Ignore iframe interaction errors
      }
    } catch (error) {
      console.log('[CaptchaSolver] Challenge interaction error:', error.message);
    }
    
    // Wait a bit and continue - sometimes the challenge resolves automatically
    // Scroll and interact naturally
    try {
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      await this.sleep(2000);
      await page.evaluate(() => {
        window.scrollBy(0, -100);
      });
    } catch (e) {
      // Ignore scroll errors
    }
    
    await this.sleep(3000);
    
    return true; // Indicates we attempted to handle it
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default CaptchaSolver;
