/**
 * Database Service
 * 
 * Manages SQLite database for user authentication, OAuth tokens, cookies, and rate limiting.
 * Uses better-sqlite3 for synchronous SQLite access with WAL mode for concurrency.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseService {
  constructor(dbPath = null) {
    // Get database path from environment or use default
    this.dbPath = dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'database', 'video-grabber.db');
    
    // Ensure database directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`[Database] Created database directory: ${dbDir}`);
    }

    // Initialize database connection
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    // Initialize schema
    this.initializeSchema();
    
    // Get encryption key from environment
    this.encryptionKey = this.getEncryptionKey();
    
    console.log(`[Database] Initialized database at: ${this.dbPath}`);
  }

  /**
   * Get or generate encryption key from environment variable
   */
  getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      console.warn('[Database] WARNING: ENCRYPTION_KEY not set, using default (NOT SECURE FOR PRODUCTION)');
      // Generate a default key (32 bytes for AES-256)
      return crypto.scryptSync('default-key-change-in-production', 'salt', 32);
    }
    
    // Convert hex string to buffer if needed, or use directly if it's already a proper key
    if (key.length === 64) {
      // Assume hex-encoded 32-byte key
      return Buffer.from(key, 'hex');
    }
    
    // Otherwise, derive key from string
    return crypto.scryptSync(key, 'video-grabber-salt', 32);
  }

  /**
   * Encrypt sensitive data before storing in database
   */
  encrypt(text) {
    if (!text) return null;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data (IV needed for decryption)
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data from database
   */
  decrypt(encryptedText) {
    if (!encryptedText) return null;
    
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        console.error('[Database] Invalid encrypted format');
        return null;
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('[Database] Decryption error:', error.message);
      return null;
    }
  }

  /**
   * Initialize database schema
   */
  initializeSchema() {
    // Users table - stores OAuth tokens and user information
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT NOT NULL,
        token_expires_at INTEGER NOT NULL,
        cookie_file_path TEXT,
        cookie_last_updated INTEGER,
        cookie_expires_at INTEGER,
        rate_limit_count INTEGER DEFAULT 0,
        rate_limit_reset_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_google_id ON users(google_id);
      CREATE INDEX IF NOT EXISTS idx_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON users(rate_limit_reset_at);
    `);

    // Audit log table - stores authentication events, cookie access, and download attempts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        event_type TEXT NOT NULL,
        event_action TEXT NOT NULL,
        event_details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER DEFAULT 1,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
    `);

    console.log('[Database] Schema initialized');
  }

  /**
   * Create or update user from OAuth profile
   */
  upsertUser(profile, tokens) {
    const userId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = tokens.expiry_date || (now + tokens.expires_in * 1000);

    // Check if user exists by google_id
    const existing = this.db.prepare('SELECT id FROM users WHERE google_id = ?').get(profile.id);
    
    if (existing) {
      // Update existing user
      const stmt = this.db.prepare(`
        UPDATE users SET
          email = ?,
          name = ?,
          picture = ?,
          access_token_encrypted = ?,
          refresh_token_encrypted = ?,
          token_expires_at = ?,
          updated_at = ?
        WHERE google_id = ?
      `);
      
      stmt.run(
        profile.emails?.[0]?.value || profile.email || '',
        profile.displayName || profile.name || '',
        profile.photos?.[0]?.value || profile.picture || '',
        this.encrypt(tokens.access_token),
        this.encrypt(tokens.refresh_token),
        expiresAt,
        now,
        profile.id
      );
      
      return existing.id;
    } else {
      // Create new user
      const stmt = this.db.prepare(`
        INSERT INTO users (
          id, google_id, email, name, picture,
          access_token_encrypted, refresh_token_encrypted, token_expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        userId,
        profile.id,
        profile.emails?.[0]?.value || profile.email || '',
        profile.displayName || profile.name || '',
        profile.photos?.[0]?.value || profile.picture || '',
        this.encrypt(tokens.access_token),
        this.encrypt(tokens.refresh_token),
        expiresAt,
        now,
        now
      );
      
      return userId;
    }
  }

  /**
   * Get user by ID
   */
  getUserById(userId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return null;
    
    return {
      ...user,
      access_token: this.decrypt(user.access_token_encrypted),
      refresh_token: this.decrypt(user.refresh_token_encrypted)
    };
  }

  /**
   * Get user by Google ID
   */
  getUserByGoogleId(googleId) {
    const user = this.db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    if (!user) return null;
    
    return {
      ...user,
      access_token: this.decrypt(user.access_token_encrypted),
      refresh_token: this.decrypt(user.refresh_token_encrypted)
    };
  }

  /**
   * Update user's cookie file path and expiration
   */
  updateUserCookies(userId, cookieFilePath, expiresAt) {
    const stmt = this.db.prepare(`
      UPDATE users SET
        cookie_file_path = ?,
        cookie_last_updated = ?,
        cookie_expires_at = ?
      WHERE id = ?
    `);
    
    stmt.run(
      cookieFilePath,
      Date.now(),
      expiresAt || null,
      userId
    );
  }

  /**
   * Check and update rate limit for user
   * Returns: { allowed: boolean, remaining: number, resetAt: number }
   */
  checkRateLimit(userId, maxRequests = 30, windowMs = 3600000) {
    const now = Date.now();
    const user = this.db.prepare('SELECT rate_limit_count, rate_limit_reset_at FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return { allowed: false, remaining: 0, resetAt: now + windowMs };
    }

    // Check if rate limit window has expired
    if (!user.rate_limit_reset_at || user.rate_limit_reset_at < now) {
      // Reset rate limit
      const resetAt = now + windowMs;
      const stmt = this.db.prepare('UPDATE users SET rate_limit_count = 0, rate_limit_reset_at = ? WHERE id = ?');
      stmt.run(resetAt, userId);
      
      return { allowed: true, remaining: maxRequests, resetAt };
    }

    // Check if user has exceeded rate limit
    if (user.rate_limit_count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: user.rate_limit_reset_at
      };
    }

    // Increment rate limit count
    const newCount = user.rate_limit_count + 1;
    const stmt = this.db.prepare('UPDATE users SET rate_limit_count = ? WHERE id = ?');
    stmt.run(newCount, userId);

    return {
      allowed: true,
      remaining: maxRequests - newCount,
      resetAt: user.rate_limit_reset_at
    };
  }

  /**
   * Update user's OAuth tokens
   */
  updateUserTokens(userId, tokens) {
    const expiresAt = tokens.expiry_date || (Date.now() + tokens.expires_in * 1000);
    const stmt = this.db.prepare(`
      UPDATE users SET
        access_token_encrypted = ?,
        refresh_token_encrypted = ?,
        token_expires_at = ?,
        updated_at = ?
      WHERE id = ?
    `);
    
    stmt.run(
      this.encrypt(tokens.access_token),
      this.encrypt(tokens.refresh_token || ''), // refresh_token might not be updated
      expiresAt,
      Date.now(),
      userId
    );
  }

  /**
   * Delete user (for account deletion)
   */
  deleteUser(userId) {
    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
    stmt.run(userId);
  }

  /**
   * Clean up expired rate limits (maintenance task)
   */
  cleanupExpiredRateLimits() {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE users SET
        rate_limit_count = 0,
        rate_limit_reset_at = NULL
      WHERE rate_limit_reset_at < ?
    `);
    
    const result = stmt.run(now);
    if (result.changes > 0) {
      console.log(`[Database] Cleaned up ${result.changes} expired rate limits`);
    }
  }

  /**
   * Log audit event
   * @param {Object} logData - { userId, eventType, eventAction, eventDetails, ipAddress, userAgent, success, errorMessage }
   */
  logAuditEvent(logData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO audit_logs (
          user_id, event_type, event_action, event_details,
          ip_address, user_agent, success, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const eventDetails = logData.eventDetails 
        ? JSON.stringify(logData.eventDetails) 
        : null;

      stmt.run(
        logData.userId || null,
        logData.eventType,
        logData.eventAction,
        eventDetails,
        logData.ipAddress || null,
        logData.userAgent || null,
        logData.success ? 1 : 0,
        logData.errorMessage || null,
        Date.now()
      );
    } catch (error) {
      console.error('[Database] Failed to log audit event:', error.message);
      // Don't throw - audit logging should not break the application
    }
  }

  /**
   * Get audit logs for a user
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of logs to return
   * @returns {Array} - Array of audit log entries
   */
  getAuditLogs(userId, limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(userId, limit);
  }

  /**
   * Clean up old audit logs (maintenance task)
   * @param {number} daysToKeep - Number of days to keep logs
   */
  cleanupOldAuditLogs(daysToKeep = 90) {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      DELETE FROM audit_logs
      WHERE created_at < ?
    `);

    const result = stmt.run(cutoffTime);
    if (result.changes > 0) {
      console.log(`[Database] Cleaned up ${result.changes} old audit logs`);
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('[Database] Database connection closed');
    }
  }
}

// Export singleton instance
let dbInstance = null;

export function getDatabase(dbPath = null) {
  if (!dbInstance) {
    dbInstance = new DatabaseService(dbPath);
  }
  return dbInstance;
}

export default DatabaseService;

