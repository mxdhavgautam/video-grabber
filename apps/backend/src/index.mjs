import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables if a local env file is present
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const localEnvPath = join(__dirname, '..', '.env.local')
const sharedEnvPath = join(__dirname, '..', '.env')

async function loadEnvIfAvailable(path) {
  try {
    const { existsSync } = await import('fs')
    if (!existsSync(path)) return

    const { config } = await import('dotenv')
    config({ path })
  } catch (error) {
    console.warn(`⚠️ Failed to load env file at ${path}:`, error.message)
  }
}

await loadEnvIfAvailable(sharedEnvPath)
await loadEnvIfAvailable(localEnvPath)

// Start the HTTP server
await import('./server.mjs')

