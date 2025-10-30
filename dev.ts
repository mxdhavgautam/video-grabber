#!/usr/bin/env bun

import { spawn } from 'bun'

console.log('🚀 Starting development servers...\n')

// Start API server using Node.js (for compatibility with ytdl-core)
console.log('Starting API server on port 3001 (using Node.js)...')
const apiServer = spawn(['node', 'server-node.mjs'], {
  stdout: 'pipe',
  stderr: 'pipe',
})

// Stream API server output
apiServer.stdout?.pipeTo(
  new WritableStream({
    write(chunk) {
      process.stdout.write(chunk)
    },
  })
)
apiServer.stderr?.pipeTo(
  new WritableStream({
    write(chunk) {
      process.stderr.write(chunk)
    },
  })
)

// Wait for API server to be ready
let apiReady = false
const checkApiReady = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://localhost:3001/api/extract?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ').catch(() => null)
      if (response && response.ok) {
        apiReady = true
        console.log('\n✅ API server is ready!\n')
        break
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!apiReady) {
    console.log('\n⚠️  API server may not be ready, but continuing anyway...\n')
  }
}

await checkApiReady()

// Start Vite
console.log('Starting Vite dev server...')
const vite = spawn(['vite'], {
  stdout: 'inherit',
  stderr: 'inherit',
})

// Cleanup on exit
const cleanup = () => {
  console.log('\n\n🛑 Shutting down servers...')
  apiServer.kill()
  vite.kill()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

