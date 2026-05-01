const Database = require('better-sqlite3');
const path = require('path');
const { nanoid } = require('nanoid');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, 'zee.db');
const db = new Database(dbPath);

// Performance optimizations for single-user
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Migrations
db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT 'New conversation',
  summary      TEXT,
  mood         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  tokens          INTEGER,
  latency_ms      INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS magic_tokens (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
`);

// --- Prepared Statements ---

// Conversations
const insertConvStmt = db.prepare(`
  INSERT INTO conversations (id, created_at, updated_at) 
  VALUES (@id, @created_at, @updated_at)
`);
const getConvsStmt = db.prepare(`
  SELECT id, title, summary, mood, message_count, updated_at, total_tokens 
  FROM conversations 
  WHERE archived = 0 
  ORDER BY updated_at DESC
`);
const getConvStmt = db.prepare(`
  SELECT * FROM conversations WHERE id = ? AND archived = 0
`);
const updateConvStmt = db.prepare(`
  UPDATE conversations 
  SET title = COALESCE(@title, title), 
      summary = COALESCE(@summary, summary), 
      mood = COALESCE(@mood, mood), 
      updated_at = @updated_at,
      message_count = @message_count,
      total_tokens = @total_tokens,
      archived = COALESCE(@archived, archived)
  WHERE id = @id
`);
const deleteConvStmt = db.prepare(`DELETE FROM conversations WHERE id = ?`);
const softDeleteConvStmt = db.prepare(`UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?`);

// Messages
const insertMsgStmt = db.prepare(`
  INSERT INTO messages (id, conversation_id, role, content, tokens, latency_ms, created_at)
  VALUES (@id, @conversation_id, @role, @content, @tokens, @latency_ms, @created_at)
`);
const getMsgsStmt = db.prepare(`
  SELECT id, role, content, tokens, latency_ms, created_at 
  FROM messages 
  WHERE conversation_id = ? 
  ORDER BY created_at ASC
`);

// Auth
const insertMagicTokenStmt = db.prepare(`
  INSERT INTO magic_tokens (token, email, expires_at) VALUES (@token, @email, @expires_at)
`);
const getMagicTokenStmt = db.prepare(`
  SELECT * FROM magic_tokens WHERE token = ? AND used = 0 AND expires_at > ?
`);
const markMagicTokenUsedStmt = db.prepare(`UPDATE magic_tokens SET used = 1 WHERE token = ?`);

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (token, email, created_at, expires_at) VALUES (@token, @email, @created_at, @expires_at)
`);
const getSessionStmt = db.prepare(`
  SELECT * FROM sessions WHERE token = ? AND expires_at > ?
`);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);

// Stats
const getStatsStmt = db.prepare(`
  SELECT 
    COUNT(id) as total_conversations,
    SUM(message_count) as total_messages,
    SUM(total_tokens) as total_tokens
  FROM conversations
  WHERE archived = 0
`);
const getAvgLatencyStmt = db.prepare(`
  SELECT AVG(latency_ms) as avg_latency 
  FROM messages 
  WHERE role = 'assistant' AND latency_ms IS NOT NULL
`);
const getConvsByDayStmt = db.prepare(`
  SELECT date(created_at/1000, 'unixepoch') as day, COUNT(*) as count 
  FROM conversations 
  WHERE archived = 0 AND created_at > ?
  GROUP BY day ORDER BY day ASC
`);
const getTopMoodsStmt = db.prepare(`
  SELECT mood, COUNT(*) as count 
  FROM conversations 
  WHERE archived = 0 AND mood IS NOT NULL 
  GROUP BY mood ORDER BY count DESC LIMIT 5
`);


// --- Helper Functions ---

module.exports = {
  db,
  
  // Conversations
  createConversation() {
    const id = nanoid();
    const now = Date.now();
    insertConvStmt.run({ id, created_at: now, updated_at: now });
    return id;
  },
  getConversations() {
    return getConvsStmt.all();
  },
  getConversation(id) {
    const conv = getConvStmt.get(id);
    if (!conv) return null;
    conv.messages = getMsgsStmt.all(id);
    return conv;
  },
  updateConversation(data) {
    updateConvStmt.run(data);
  },
  deleteConversation(id, hard = false) {
    if (hard) {
      deleteConvStmt.run(id);
    } else {
      softDeleteConvStmt.run(Date.now(), id);
    }
  },

  // Messages
  insertMessage(data) {
    const id = nanoid();
    const now = Date.now();
    insertMsgStmt.run({
      id,
      conversation_id: data.conversation_id,
      role: data.role,
      content: data.content,
      tokens: data.tokens || null,
      latency_ms: data.latency_ms || null,
      created_at: now
    });
    
    // Update conversation stats
    const conv = getConvStmt.get(data.conversation_id);
    if (conv) {
      updateConvStmt.run({
        id: conv.id,
        updated_at: now,
        message_count: conv.message_count + 1,
        total_tokens: conv.total_tokens + (data.tokens || 0),
        title: conv.title,
        summary: conv.summary,
        mood: conv.mood,
        archived: conv.archived
      });
    }
    return id;
  },
  getRecentMessages(conversationId, maxTokens = 1500) {
    // Basic heuristic: ~4 chars per token. 
    // We fetch messages backwards until we hit the limit, then reverse.
    const allMsgs = getMsgsStmt.all(conversationId);
    let tokenEstimate = 0;
    const recent = [];
    
    for (let i = allMsgs.length - 1; i >= 0; i--) {
      const msg = allMsgs[i];
      const est = Math.ceil(msg.content.length / 4);
      if (tokenEstimate + est > maxTokens && recent.length > 0) {
        break;
      }
      tokenEstimate += est;
      recent.unshift(msg);
    }
    return recent;
  },

  // Auth
  createMagicToken(email) {
    const token = require('crypto').randomBytes(16).toString('hex');
    const expires_at = Date.now() + 15 * 60 * 1000; // 15 mins
    insertMagicTokenStmt.run({ token, email, expires_at });
    return token;
  },
  verifyMagicToken(token) {
    const record = getMagicTokenStmt.get(token, Date.now());
    if (record) {
      markMagicTokenUsedStmt.run(token);
      return record;
    }
    return null;
  },
  createSession(email) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const now = Date.now();
    const expires_at = now + 30 * 24 * 60 * 60 * 1000; // 30 days
    insertSessionStmt.run({ token, email, created_at: now, expires_at });
    return { token, expires_at };
  },
  getSession(token) {
    return getSessionStmt.get(token, Date.now());
  },
  deleteSession(token) {
    deleteSessionStmt.run(token);
  },

  // Stats
  getStats() {
    const stats = getStatsStmt.get() || { total_conversations: 0, total_messages: 0, total_tokens: 0 };
    const latency = getAvgLatencyStmt.get() || { avg_latency: 0 };
    
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const convsByDay = getConvsByDayStmt.all(thirtyDaysAgo);
    const topMoods = getTopMoodsStmt.all();
    
    return {
      ...stats,
      avg_latency: latency.avg_latency || 0,
      conversations_by_day: convsByDay,
      top_moods: topMoods
    };
  }
};
