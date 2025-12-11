import sqlite3pkg from 'sqlite3';
const sqlite3 = sqlite3pkg.verbose();

const db = new sqlite3.Database('./database.sqlite');

// === CREATE TABLES ===
export function init() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        text TEXT,
        task_type TEXT,
        length INTEGER,
        suspicious INTEGER,
        created_at INTEGER,
        status TEXT DEFAULT 'pending',
        number INTEGER DEFAULT 0,
        type TEXT DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
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
      )
    `);
  });
}

// === HELPERS ===

export function ensureUserByTelegram(telegram_id, username, display) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE telegram_id = ?`,
      [telegram_id],
      (err, row) => {
        if (err) return reject(err);
        if (row) return resolve(row);

        db.run(
          `INSERT INTO users (telegram_id, username, display_name) VALUES (?, ?, ?)`,
          [telegram_id, username, display],
          function (err2) {
            if (err2) return reject(err2);
            db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (e, r) =>
              e ? reject(e) : resolve(r)
            );
          }
        );
      }
    );
  });
}

export function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) =>
      err ? reject(err) : resolve(row)
    );
  });
}

export function listUsers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM users ORDER BY id DESC`, (err, rows) =>
      err ? reject(err) : resolve(rows)
    );
  });
}

export function addReport({ user_id, text, created_at }) {
  return new Promise((resolve, reject) => {
    const length = text ? text.length : 0;
    const suspicious = length < 5 ? 1 : 0;
    const task_type = length < 20 ? 'short' : 'long';

    db.run(
      `INSERT INTO reports (user_id, text, task_type, length, suspicious, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, text, task_type, length, suspicious, created_at],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT reports.*, users.username FROM reports LEFT JOIN users ON users.id = reports.user_id WHERE reports.id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listReports(limit = 1000) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT reports.*, users.username 
       FROM reports 
       LEFT JOIN users ON users.id = reports.user_id
       ORDER BY reports.id DESC 
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function listReportsForUser(user_id, limit = 200) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [user_id, limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function summaryForUser(user_id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
         COUNT(*) AS total,
         SUM(length) AS total_length,
         SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) AS suspicious
       FROM reports
       WHERE user_id = ?`,
      [user_id],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

export function addFeedback({ user_id, manager_id, message, created_at }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO feedback (user_id, manager_id, message, created_at)
       VALUES (?, ?, ?, ?)`,
      [user_id, manager_id, message, created_at],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM feedback WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listFeedback() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT feedback.*, u.username AS user_name, m.username AS manager_name
       FROM feedback
       LEFT JOIN users u ON u.id = feedback.user_id
       LEFT JOIN users m ON m.id = feedback.manager_id
       ORDER BY feedback.id DESC`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function globalSummary() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
         COUNT(*) AS reports_total,
         SUM(length) AS total_length,
         SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) AS suspicious_total
       FROM reports
       WHERE status = 'approved'`,
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

export function updateReportStatus(id, status, number = 0, type = '') {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE reports 
       SET status = ?, number = ?, type = ? 
       WHERE id = ?`,
      [status, number, type, id],
      function (err) {
        if (err) return reject(err);
        db.get(
          `SELECT reports.*, users.username
           FROM reports
           LEFT JOIN users ON users.id = reports.user_id
           WHERE reports.id = ?`,
          [id],
          (e, row) => (e ? reject(e) : resolve(row))
        );
      }
    );
  });
}
