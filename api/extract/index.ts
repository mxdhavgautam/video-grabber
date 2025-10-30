import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.query

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' })
  }

  // Route to appropriate extractor based on URL
  if (/youtube\.com|youtu\.be/i.test(url)) {
    const youtubeHandler = (await import('./youtube')).default
    return youtubeHandler(req, res)
  }

  if (/instagram\.com/i.test(url)) {
    const instagramHandler = (await import('./instagram')).default
    return instagramHandler(req, res)
  }

  if (/facebook\.com|fb\.com/i.test(url)) {
    const facebookHandler = (await import('./facebook')).default
    return facebookHandler(req, res)
  }

  if (/twitter\.com|x\.com/i.test(url)) {
    const twitterHandler = (await import('./twitter')).default
    return twitterHandler(req, res)
  }

  return res.status(400).json({
    error: 'Unsupported platform',
    message: 'URL must be from YouTube, Instagram, Facebook, or Twitter',
  })
}

