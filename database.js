import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./database.db');

// Create tables
export function init() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      telegram_id TEXT,
      created_at INTEGER
    );
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      text TEXT,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      manager_id INTEGER,
      message TEXT,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(manager_id) REFERENCES users(id)
    );
  `);
}

// Ensure user exists or create new one
export async function ensureUserByTelegram(telegramId, username, display_name) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], (err, row) => {
      if (err) reject(err);
      if (row) return resolve(row);
      
      db.run(
        `INSERT INTO users (telegram_id, username, created_at) VALUES (?, ?, ?)`,
        [telegramId, username, Date.now()],
        function(err) {
          if (err) reject(err);
          resolve({ id: this.lastID, telegram_id: telegramId, username, created_at: Date.now() });
        }
      );
    });
  });
}

// Add report
export async function addReport({ user_id, text, created_at }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO reports (user_id, text, created_at) VALUES (?, ?, ?)`,
      [user_id, text, created_at],
      function(err) {
        if (err) reject(err);
        resolve({ id: this.lastID, user_id, text, created_at });
      }
    );
  });
}

// List users
export async function listUsers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM users`, (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
}

// Get user by username
export async function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
      if (err) reject(err);
      resolve(row);
    });
  });
}

// Get global summary (example)
export async function globalSummary() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT u.username, COUNT(r.id) AS reportsCount
      FROM users u
      LEFT JOIN reports r ON u.id = r.user_id
      GROUP BY u.id
      ORDER BY reportsCount DESC
      LIMIT 10
    `, (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
}

// Add feedback (example)
export async function addFeedback({ user_id, manager_id, message, created_at }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO feedback (user_id, manager_id, message, created_at) VALUES (?, ?, ?, ?)`,
      [user_id, manager_id, message, created_at],
      function(err) {
        if (err) reject(err);
        resolve({ id: this.lastID, user_id, manager_id, message, created_at });
      }
    );
  });
}

// List reports
export async function listReports(limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM reports ORDER BY created_at DESC LIMIT ?`, [limit], (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
}

// List feedback
export async function listFeedback() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM feedback ORDER BY created_at DESC`, (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
}
