#!/usr/bin/env node

// Warmup script using Puppeteer with stealth to generate YouTube cookies
// This script navigates to YouTube and waits for cookies to be set

import puppeteer from 'puppeteer-core'
import fs from 'fs'

const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || '/app/chrome-profiles/profile-warmup'
const CHROME_DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222'

async function warmupCookies() {
  console.log('🔥 Starting Puppeteer warmup with stealth...')
  console.log(`   Profile: ${CHROME_PROFILE_DIR}`)
  console.log(`   Debug URL: ${CHROME_DEBUG_URL}`)
  
  let browser
  try {
    // Connect to existing Chrome instance
    browser = await puppeteer.connect({
      browserURL: CHROME_DEBUG_URL,
      defaultViewport: { width: 1920, height: 1080 }
    })
    
    const page = await browser.newPage()
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 })
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
    
    // Set headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    })
    
    // Apply stealth techniques
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      })
      
      // Fake plugins array
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })
      
      // Set realistic languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      })
      
      // Add chrome object
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        }
      }
    })
    
    console.log('🌐 Navigating to YouTube...')
    await page.goto('https://www.youtube.com', { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    })
    
    console.log('✅ YouTube loaded, waiting for cookies to be set...')
    
    // Wait for cookies to be set (give YouTube time to execute JavaScript)
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 10000)))
    
    // Check cookies
    const cookies = await page.cookies()
    console.log(`📊 Cookies found: ${cookies.length}`)
    
    const youtubeCoookies = cookies.filter(c => c.domain.includes('youtube.com') || c.domain.includes('.google.com'))
    console.log(`📊 YouTube cookies: ${youtubeCoookies.length}`)
    
    const visitorCookie = cookies.find(c => c.name === 'VISITOR_INFO1_LIVE')
    if (visitorCookie) {
      console.log('✅ VISITOR_INFO1_LIVE cookie found!')
    } else {
      console.log('⚠️ VISITOR_INFO1_LIVE cookie NOT found')
    }
    
    const yscCookie = cookies.find(c => c.name === 'YSC')
    if (yscCookie) {
      console.log('✅ YSC cookie found!')
    } else {
      console.log('⚠️ YSC cookie NOT found')
    }
    
    // Navigate to a specific video to trigger more cookies
    console.log('🎥 Navigating to a specific video to trigger more cookies...')
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      waitUntil: 'networkidle2',
      timeout: 60000
    })
    
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 10000)))
    
    const cookies2 = await page.cookies()
    console.log(`📊 Cookies after video page: ${cookies2.length}`)
    
    const youtubeCoookies2 = cookies2.filter(c => c.domain.includes('youtube.com') || c.domain.includes('.google.com'))
    console.log(`📊 YouTube cookies after video: ${youtubeCoookies2.length}`)
    
    // Disconnect from browser (don't close it)
    browser.disconnect()
    
    console.log('✅ Warmup complete - Chrome remains running with cookies')
    process.exit(0)
    
  } catch (error) {
    console.error('❌ Warmup failed:', error.message)
    if (browser) {
      try {
        browser.disconnect()
      } catch {}
    }
    process.exit(1)
  }
}

warmupCookies()

