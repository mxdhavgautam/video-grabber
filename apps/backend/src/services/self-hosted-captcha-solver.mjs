/**
 * Self-Hosted CAPTCHA Solver Service
 * 
 * Uses open-source OCR libraries to solve simple image/text CAPTCHAs:
 * - ddddocr: Popular Chinese CAPTCHA solver (works for many types)
 * - pytesseract: Tesseract OCR wrapper (text recognition)
 * - Pillow: Image processing
 * 
 * Limitations:
 * - Simple text/image CAPTCHAs: Good success rate
 * - reCAPTCHA v2/v3: Cannot solve (requires browser interactions)
 * - hCaptcha: Cannot solve (requires clicking specific images)
 * - YouTube challenges: Behavioral, not image-based
 * 
 * For complex CAPTCHAs, commercial services (2Captcha, etc.) are still recommended.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

class SelfHostedCaptchaSolver {
  constructor() {
    this.pythonAvailable = this.checkPythonAvailable();
    this.ddddocrAvailable = false;
    this.pytesseractAvailable = false;
    
    if (this.pythonAvailable) {
      this.checkLibrariesAvailable();
    }
    
    if (this.ddddocrAvailable || this.pytesseractAvailable) {
      console.log('[SelfHostedCaptchaSolver] ✓ Open-source CAPTCHA solver available');
    } else {
      console.log('[SelfHostedCaptchaSolver] Open-source solver not fully available (optional)');
      console.log('[SelfHostedCaptchaSolver] Install with: pip install ddddocr pytesseract pillow');
    }
  }

  checkPythonAvailable() {
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  checkLibrariesAvailable() {
    try {
      // Check for ddddocr
      try {
        execSync('python3 -c "import ddddocr; print(ddddocr.__version__)"', { stdio: 'ignore' });
        this.ddddocrAvailable = true;
        console.log('[SelfHostedCaptchaSolver] ✓ ddddocr library available');
      } catch (e) {
        console.log('[SelfHostedCaptchaSolver] ddddocr not installed (optional)');
      }

      // Check for pytesseract
      try {
        execSync('python3 -c "import pytesseract; print(pytesseract.__version__)"', { stdio: 'ignore' });
        this.pytesseractAvailable = true;
        console.log('[SelfHostedCaptchaSolver] ✓ pytesseract library available');
      } catch (e) {
        console.log('[SelfHostedCaptchaSolver] pytesseract not installed (optional)');
      }
    } catch (error) {
      console.warn('[SelfHostedCaptchaSolver] Error checking libraries:', error.message);
    }
  }

  /**
   * Solve simple image CAPTCHA using OCR
   * @param {Buffer|string} imageData - Image buffer or file path
   * @returns {Promise<string|null>} Solved text or null if failed
   */
  async solveImageCaptcha(imageData) {
    if (!this.pythonAvailable) {
      console.warn('[SelfHostedCaptchaSolver] Python not available');
      return null;
    }

    // Try ddddocr first (better for many CAPTCHA types)
    if (this.ddddocrAvailable) {
      try {
        const solution = await this.solveWithDdddocr(imageData);
        if (solution) {
          return solution;
        }
      } catch (error) {
        console.warn('[SelfHostedCaptchaSolver] ddddocr solving failed:', error.message);
      }
    }

    // Fallback to pytesseract
    if (this.pytesseractAvailable) {
      try {
        const solution = await this.solveWithPytesseract(imageData);
        if (solution) {
          return solution;
        }
      } catch (error) {
        console.warn('[SelfHostedCaptchaSolver] pytesseract solving failed:', error.message);
      }
    }

    return null;
  }

  /**
   * Solve using ddddocr (good for many CAPTCHA types)
   */
  async solveWithDdddocr(imageData) {
    const tempFile = path.join('/tmp', `captcha_${Date.now()}.png`);
    
    try {
      // Save image to temp file
      if (Buffer.isBuffer(imageData)) {
        fs.writeFileSync(tempFile, imageData);
      } else {
        fs.copyFileSync(imageData, tempFile);
      }

      // Call Python script
      const pythonScript = `
import ddddocr
import sys

ocr = ddddocr.DdddOcr()
with open('${tempFile}', 'rb') as f:
    image = f.read()
result = ocr.classification(image)
print(result)
`;
      
      const scriptFile = path.join('/tmp', `ddddocr_solve_${Date.now()}.py`);
      fs.writeFileSync(scriptFile, pythonScript);
      
      const result = execSync(`python3 ${scriptFile}`, { encoding: 'utf-8' }).trim();
      
      // Cleanup
      fs.unlinkSync(scriptFile);
      fs.unlinkSync(tempFile);
      
      if (result && result.length > 0) {
        console.log(`[SelfHostedCaptchaSolver] ddddocr solution: ${result}`);
        return result;
      }
      
      return null;
    } catch (error) {
      // Cleanup on error
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (e) {}
      
      throw error;
    }
  }

  /**
   * Solve using pytesseract (OCR for text CAPTCHAs)
   */
  async solveWithPytesseract(imageData) {
    const tempFile = path.join('/tmp', `captcha_${Date.now()}.png`);
    
    try {
      // Save image to temp file
      if (Buffer.isBuffer(imageData)) {
        fs.writeFileSync(tempFile, imageData);
      } else {
        fs.copyFileSync(imageData, tempFile);
      }

      // Preprocess image (improve OCR accuracy)
      const pythonScript = `
from PIL import Image
import pytesseract
import sys

# Open and preprocess image
img = Image.open('${tempFile}')
# Convert to grayscale
img = img.convert('L')
# Increase contrast
from PIL import ImageEnhance
enhancer = ImageEnhance.Contrast(img)
img = enhancer.enhance(2.0)
# Resize if too small
if img.width < 100:
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)

# OCR
text = pytesseract.image_to_string(img, config='--psm 7 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
print(text.strip())
`;
      
      const scriptFile = path.join('/tmp', `pytesseract_solve_${Date.now()}.py`);
      fs.writeFileSync(scriptFile, pythonScript);
      
      const result = execSync(`python3 ${scriptFile}`, { encoding: 'utf-8' }).trim();
      
      // Cleanup
      fs.unlinkSync(scriptFile);
      fs.unlinkSync(tempFile);
      
      if (result && result.length > 0) {
        console.log(`[SelfHostedCaptchaSolver] pytesseract solution: ${result}`);
        return result;
      }
      
      return null;
    } catch (error) {
      // Cleanup on error
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (e) {}
      
      throw error;
    }
  }

  /**
   * Extract CAPTCHA image from page and solve
   * Note: This is limited - reCAPTCHA/hCaptcha cannot be extracted this way
   */
  async solveCaptchaFromPage(page) {
    // This is a simplified approach - real CAPTCHAs need more complex handling
    // For simple text CAPTCHAs embedded in pages
    try {
      const captchaImage = await page.$('img[alt*="captcha" i], img[src*="captcha" i], .captcha img');
      if (captchaImage) {
        const screenshot = await captchaImage.screenshot();
        return await this.solveImageCaptcha(screenshot);
      }
    } catch (error) {
      console.warn('[SelfHostedCaptchaSolver] Could not extract CAPTCHA from page:', error.message);
    }
    
    return null;
  }
}

export default SelfHostedCaptchaSolver;

