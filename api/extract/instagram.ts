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

  // Instagram requires authenticated API access
  // Using oEmbed as fallback
  try {
    const oEmbedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`
    const response = await fetch(oEmbedUrl)
    
    if (!response.ok) {
      throw new Error('Failed to fetch Instagram info')
    }

    const data = await response.json()
    const shortcode = url.match(/instagram\.com\/(?:p|reel|tv)\/([^\/\?]+)/i)?.[1]

    return res.status(200).json({
      id: shortcode || 'unknown',
      title: data.title || 'Instagram Video',
      thumbnail: data.thumbnail_url || '',
      duration: 0,
      formats: [
        {
          format_id: 'best',
          format_note: 'Best Quality',
          ext: 'mp4',
          protocol: 'https',
        },
      ],
      webpage_url: url,
      platform: 'instagram',
    })
  } catch (error) {
    console.error('Error fetching Instagram info:', error)
    return res.status(500).json({
      error: 'Failed to fetch Instagram information',
      message: 'Instagram extraction requires API access. This is a placeholder.',
    })
  }
}

