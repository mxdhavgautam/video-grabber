/**
 * SQLite Session Store for express-session
 * 
 * Provides persistent session storage using SQLite, so sessions survive container restarts.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SQLiteSessionStore {
  constructor(options = {}) {
    const dbPath = options.dbPath || process.env.SESSION_DB_PATH || 
                   path.join(process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : process.cwd(), 'database', 'sessions.db');
    
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Create sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_expire ON sessions(expire);
    `);

    // Cleanup expired sessions periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // Every hour

    console.log('[SessionStore] Initialized SQLite session store at:', dbPath);
  }

  /**
   * Get session by ID
   */
  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Date.now());
      
      if (row) {
        const session = JSON.parse(row.sess);
        return callback(null, session);
      }
      
      return callback(null, null);
    } catch (error) {
      return callback(error);
    }
  }

  /**
   * Set session
   */
  set(sid, sess, callback) {
    try {
      const expire = sess.cookie && sess.cookie.expires 
        ? sess.cookie.expires.getTime() 
        : Date.now() + (24 * 60 * 60 * 1000); // Default 24 hours
      
      const sessJson = JSON.stringify(sess);
      
      this.db.prepare(`
        INSERT OR REPLACE INTO sessions (sid, sess, expire)
        VALUES (?, ?, ?)
      `).run(sid, sessJson, expire);
      
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  /**
   * Destroy session
   */
  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  /**
   * Touch session (update expiration)
   */
  touch(sid, sess, callback) {
    try {
      const expire = sess.cookie && sess.cookie.expires 
        ? sess.cookie.expires.getTime() 
        : Date.now() + (24 * 60 * 60 * 1000);
      
      this.db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  /**
   * Cleanup expired sessions
   */
  cleanup() {
    try {
      const deleted = this.db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now());
      if (deleted.changes > 0) {
        console.log(`[SessionStore] Cleaned up ${deleted.changes} expired sessions`);
      }
    } catch (error) {
      console.error('[SessionStore] Cleanup error:', error.message);
    }
  }

  /**
   * Get all sessions (for debugging)
   */
  all(callback) {
    try {
      const rows = this.db.prepare('SELECT sid, sess FROM sessions WHERE expire > ?').all(Date.now());
      const sessions = rows.map(row => ({
        sid: row.sid,
        sess: JSON.parse(row.sess)
      }));
      return callback(null, sessions);
    } catch (error) {
      return callback(error);
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.db.close();
  }
}

export default SQLiteSessionStore;

