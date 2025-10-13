import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath);

// Modify the schema to add the feedback table and message table if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    session_name TEXT,
    group_id INTEGER DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Use message_id instead of id as the primary key for messages
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,  
    session_id INTEGER,
    username TEXT,
    role TEXT,
    content TEXT,
    collapsed INTEGER DEFAULT 0,
    scale_level INTEGER DEFAULT 1,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )`);

  // Create feedback table to store feedback content and position
  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    message_id INTEGER,
    username TEXT,
    content TEXT,
    position TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(message_id) REFERENCES messages(message_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS scale_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    username TEXT,
    scale_level INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )`);

  // Create groups table
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    group_name TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Add group_id column to sessions table if it doesn't exist
  db.run(`ALTER TABLE sessions ADD COLUMN group_id INTEGER DEFAULT NULL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding group_id column to sessions table:', err);
    }
  });

  // Add username column to sessions table if it doesn't exist
  db.run(`ALTER TABLE sessions ADD COLUMN username TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding username column to sessions table:', err);
    }
  });

  db.run(`ALTER TABLE messages ADD COLUMN collapsed INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding collapsed column:', err);
    }
  });

  db.run(`ALTER TABLE messages ADD COLUMN scale_level INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding scale_level column to messages table:', err);
    }
  });

  // Add username column to messages table if it doesn't exist
  db.run(`ALTER TABLE messages ADD COLUMN username TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding username column to messages table:', err);
    }
  });

  // Add username column to feedback table if it doesn't exist
  db.run(`ALTER TABLE feedback ADD COLUMN username TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding username column to feedback table:', err);
    }
  });

  // Add username column to scale_levels table if it doesn't exist
  db.run(`ALTER TABLE scale_levels ADD COLUMN username TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding username column to scale_levels table:', err);
    }
  });

  // Add username column to groups table if it doesn't exist
  db.run(`ALTER TABLE groups ADD COLUMN username TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding username column to groups table:', err);
    }
  });
});

// Function to register a new user
const registerUser = (username, password, callback) => {
  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, password], function (err) {
    if (err) {
      console.error('Error in registerUser:', err.message);
      return callback(err);
    }
    callback(null, this.lastID);
  });
};

// Function to get a user by username
const getUser = (username, callback) => {
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
    if (err) {
      console.error('Error in getUser:', err.message);
      return callback(err);
    }
    callback(null, row);
  });
};

// Function to create a new session
const createSession = (user_id, username, session_name, callback) => {
  const cb = typeof callback === 'function' ? callback : () => {};
  const sql = `INSERT INTO sessions (user_id, username, session_name) VALUES (?, ?, ?)`;
  db.run(sql, [user_id, username, session_name], function(err) {
    if (err) {
      console.error('Error in createSession (inserting session):', err.message);
      return cb(err);
    }
    const sessionId = this.lastID;
    const scaleLevelSql = `INSERT INTO scale_levels (session_id, username, scale_level) VALUES (?, ?, ?)`;
    db.run(scaleLevelSql, [sessionId, username, 1], function(scaleErr) {
      if (scaleErr) {
        console.error('Error in createSession (inserting initial scale level):', scaleErr.message);
      }
      cb(null, sessionId);
    });
  });
};


// Update the saveMessage function to include collapsed parameter and username
const saveMessage = (session_id, username, role, content, collapsed = 0, callback) => {
  const sql = `INSERT INTO messages (session_id, username, role, content, collapsed) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [session_id, username, role, content, collapsed], function (err) {
    if (err) {
      console.error('Error in saveMessage:', err.message);
      return callback(err);
    }
    callback(null, this.lastID);
  });
};

// Save message with scale_level and username
const saveMessageWithScaleLevel = (session_id, username, role, content, collapsed = 0, scale_level = 1, callback) => {
  const sql = `INSERT INTO messages (session_id, username, role, content, collapsed, scale_level) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(sql, [session_id, username, role, content, collapsed, scale_level], function (err) {
    if (err) {
      console.error('Error in saveMessageWithScaleLevel:', err.message);
      return callback(err);
    }
    callback(null, this.lastID);
  });
};

// Function to save feedback for the last message if message_id is not provided
// position is deprecated; pass null.
const saveFeedback = (session_id, message_id, username, content, position, callback) => {
  console.log('[saveFeedback] Called with:', {
    session_id,
    message_id,
    username,
    content,
    position
  });
  if (!message_id) {
    const sql = `SELECT message_id FROM messages WHERE session_id = ? ORDER BY message_id DESC LIMIT 1`;
    db.get(sql, [session_id], (err, row) => {
      if (err) {
        console.error('Error in saveFeedback (getting last message_id):', err.message);
        return callback(err);
      }
      if (row && row.message_id) {
        message_id = row.message_id;
        insertFeedback(session_id, message_id, username, content, position, callback);
      } else {
        console.error('Error in saveFeedback: No message found for the given session.');
        return callback(new Error('No message found for the given session.'));
      }
    });
  } else {
    insertFeedback(session_id, message_id, username, content, position, callback);
  }
};

// Helper function to insert feedback into the database
const insertFeedback = (session_id, message_id, username, content, position, callback) => {
  console.log('[insertFeedback] Inserting feedback with:', {
    session_id,
    message_id,
    username,
    content,
    position
  });
  const sql = `INSERT INTO feedback (session_id, message_id, username, content, position) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [session_id, message_id, username, content, position || null], function (err) {
    if (err) {
      console.error('Error in insertFeedback:', err.message);
      return callback(err);
    }
    callback(null);
  });
};


// Function to retrieve feedback for a session (coordinates deprecated)
const getFeedback = (session_id, callback) => {
  const sql = `SELECT * FROM feedback WHERE session_id = ?`;
  db.all(sql, [session_id], (err, rows) => {
    if (err) {
      console.error('Error in getFeedback:', err.message);
      return callback(err);
    }
    const feedbackData = rows.map(row => ({
      messageId: row.message_id,
      feedbackContent: row.content
    }));
    callback(null, feedbackData.length ? feedbackData : []);
  });
};

// Function to retrieve messages for a session
const getMessages = (session_id, callback) => {
  db.all(`SELECT * FROM messages WHERE session_id = ? ORDER BY message_id ASC`, [session_id], (err, rows) => {
    if (err) {
      console.error('Error in getMessages:', err.message);
      return callback(err);
    }
    callback(null, rows);
  });
};

// Function to retrieve sessions for a user
const getSessions = (user_id, callback) => {
  db.all(`SELECT * FROM sessions WHERE user_id = ?`, [user_id], (err, rows) => {
    if (err) {
      console.error('Error in getSessions:', err.message);
      return callback(err);
    }
    callback(null, rows);
  });
};

// Function to delete a session and its associated messages and feedback
const deleteSession = (session_id, callback) => {
    db.serialize(() => {
        db.run(`DELETE FROM scale_levels WHERE session_id = ?`, [session_id], function(err) {
            if (err) {
                console.error('Error in deleteSession (deleting scale_levels):', err.message);
                return callback(err);
            }
            db.run(`DELETE FROM feedback WHERE session_id = ?`, [session_id], function(err) {
                if (err) {
                    console.error('Error in deleteSession (deleting feedback):', err.message);
                    return callback(err);
                }
                db.run(`DELETE FROM messages WHERE session_id = ?`, [session_id], function(err) {
                    if (err) {
                        console.error('Error in deleteSession (deleting messages):', err.message);
                        return callback(err);
                    }
                    db.run(`DELETE FROM sessions WHERE id = ?`, [session_id], function(err) {
                        if (err) {
                            console.error('Error in deleteSession (deleting session):', err.message);
                            return callback(err);
                        }
                        callback(null);
                    });
                });
            });
        });
    });
};


// Function to get the next available session ID
const getNextSessionId = () => {
  return new Promise((resolve, reject) => {
    db.get('SELECT MAX(id) as maxId FROM sessions', (err, row) => {
      if (err) {
        console.error('Error in getNextSessionId:', err.message);
        reject(err);
      } else {
        const nextId = (row.maxId || 0) + 1;
        resolve(nextId);
      }
    });
  });
};

// Add a new function to update collapsed state
const updateMessageCollapsedState = (message_id, collapsed, callback) => {
  const sql = `UPDATE messages SET collapsed = ? WHERE message_id = ?`;
  
  db.run(sql, [collapsed, message_id], function (err) {
    if (err) {
      console.error('Error in updateMessageCollapsedState:', err.message);
      return callback(err);
    }
    callback(null);
  });
};

// Function to delete a group
const deleteGroup = (group_id, callback) => {
  db.run(`UPDATE sessions SET group_id = NULL WHERE group_id = ?`, [group_id], (err) => {
    if (err) {
      console.error('Error in deleteGroup (updating sessions):', err.message);
      return callback(err);
    }
    db.run(`DELETE FROM groups WHERE id = ?`, [group_id], function(err) {
      if (err) {
        console.error('Error in deleteGroup (deleting group):', err.message);
        return callback(err);
      }
      callback(null);
    });
  });
};

// Function to get all groups for a user
const getUserGroups = (user_id, callback) => {
  db.all(`SELECT * FROM groups WHERE user_id = ? ORDER BY id ASC`, [user_id], (err, rows) => {
    if (err) {
      console.error('Error in getUserGroups:', err.message);
      return callback(err);
    }
    callback(null, rows);
  });
};

// Function to update a session's group
const updateSessionGroup = (session_id, group_id, callback) => {
  db.run(`UPDATE sessions SET group_id = ? WHERE id = ?`, [group_id, session_id], function(err) {
    if (err) {
      console.error('Error in updateSessionGroup:', err.message);
      return callback(err);
    }
    callback(null);
  });
};

const renameGroup = (group_id, group_name, callback) => {
  db.run(`UPDATE groups SET group_name = ? WHERE id = ?`, [group_name, group_id], function(err) {
    if (err) {
      console.error('Error in renameGroup:', err.message);
      return callback(err);
    }
    callback(null);
  });
};

// Function to get all scale levels for a session
const getScaleLevels = (session_id, callback) => {
  const sql = `SELECT scale_level FROM scale_levels WHERE session_id = ?`;
  db.all(sql, [session_id], (err, rows) => {
    if (err) {
      console.error('Error in getScaleLevels:', err.message);
      return callback(err, null);
    }
    callback(null, rows);
  });
};

// Function to create a new group
const createGroup = (user_id, username, group_name, callback) => {
  const sql = `INSERT INTO groups (user_id, username, group_name) VALUES (?, ?, ?)`;
  db.run(sql, [user_id, username, group_name], function(err) {
    if (err) {
      console.error('Error in createGroup:', err.message);
      return callback(err);
    }
    callback(null, this.lastID);
  });
};

// Function to get a message by session_id and content
const getMessageByContent = (session_id, content, callback) => {
  const sql = `SELECT * FROM messages WHERE session_id = ? AND content = ?`;
  db.get(sql, [session_id, content], (err, row) => {
    if (err) {
      console.error('Error in getMessageByContent:', err.message);
      return callback(err, null);
    }
    callback(null, row);
  });
};

// Function to save a scale level for a session
const saveScaleLevel = (session_id, username, scale_level, callback) => {
  const cb = typeof callback === 'function' ? callback : () => {};
  const sql = `INSERT INTO scale_levels (session_id, username, scale_level) VALUES (?, ?, ?)`;
  db.run(sql, [session_id, username, scale_level], function(err) {
    if (err) {
      console.error('Error in saveScaleLevel:', err.message);
      return cb(err);
    }
    cb(null, this.lastID);
  });
};

// Exporting the functions
export {
  registerUser,
  getUser,
  createSession,
  saveMessage,
  saveFeedback,
  getSessions,
  getMessages,
  getFeedback,
  deleteSession,
  getNextSessionId,
  getMessageByContent,
  saveScaleLevel,
  getScaleLevels,
  updateMessageCollapsedState,
  createGroup,
  deleteGroup,
  getUserGroups,
  updateSessionGroup,
  renameGroup,
  saveMessageWithScaleLevel
};

