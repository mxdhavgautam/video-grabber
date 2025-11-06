/**
 * Authentication Hook
 * Manages user authentication state
 */

import { useState, useEffect } from 'react'
import { getCurrentUser, logout, type User } from '@/lib/auth'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      setIsLoading(true)
      const currentUser = await getCurrentUser()
      setUser(currentUser)
      setIsAuthenticated(currentUser !== null)
    } catch (error) {
      console.error('Auth check failed:', error)
      setUser(null)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    setUser(null)
    setIsAuthenticated(false)
  }

  return {
    user,
    isLoading,
    isAuthenticated,
    checkAuth,
    logout: handleLogout,
  }
}

