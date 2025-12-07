import sqlite3pkg from 'sqlite3';
const sqlite3 = sqlite3pkg.verbose();

const db = new sqlite3.Database('./database.sqlite');

// === CREATE TABLES + columns status/source ===
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
        status INTEGER DEFAULT 0,
        source TEXT DEFAULT 'telegram',
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

    // --- добавляем колонки если их нет (без потери данных)
    db.get("PRAGMA table_info(reports)", (err, rows) => {
      const cols = (rows||[]).map(r => r.name);
      if(!cols.includes('status')) db.run("ALTER TABLE reports ADD COLUMN status INTEGER DEFAULT 0");
      if(!cols.includes('source')) db.run("ALTER TABLE reports ADD COLUMN source TEXT DEFAULT 'telegram'");
    });
  });
}

// === HELPERS ===
export function ensureUserByTelegram(telegram_id, username, display) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegram_id], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      db.run(
        `INSERT INTO users (telegram_id, username, display_name) VALUES (?, ?, ?)`,
        [telegram_id, username, display],
        function (err2) {
          if (err2) return reject(err2);
          db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (e, r) => e ? reject(e) : resolve(r));
        }
      );
    });
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

// === REPORTS ===
export function addReport({ user_id, text, created_at, source = 'telegram', status = 0 }) {
  return new Promise((resolve, reject) => {
    const length = text ? text.length : 0;
    const suspicious = length < 5 ? 1 : 0;
    const task_type = length < 20 ? 'short' : 'long';

    db.run(
      `INSERT INTO reports (user_id, text, task_type, length, suspicious, created_at, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, text, task_type, length, suspicious, created_at, status, source],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM reports WHERE id = ?`, [this.lastID], (e, r) => e ? reject(e) : resolve(r));
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

// === FEEDBACK ===
export function addFeedback({ user_id, manager_id, message, created_at }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO feedback (user_id, manager_id, message, created_at)
       VALUES (?, ?, ?, ?)`,
      [user_id, manager_id, message, created_at],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM feedback WHERE id = ?`, [this.lastID], (e, r) => e ? reject(e) : resolve(r));
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
       FROM reports`,
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

// === WEB REPORTS FUNCTIONS ===
export function listWebReports(limit = 5) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT reports.*, users.username
       FROM reports
       LEFT JOIN users ON users.id = reports.user_id
       WHERE source = 'web'
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function listPendingWebReports(limit = 1000) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT reports.*, users.username
       FROM reports
       LEFT JOIN users ON users.id = reports.user_id
       WHERE source = 'web' AND status = 0
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function updateReportStatus(report_id, status) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE reports SET status = ? WHERE id = ?`, [status, report_id], function (err) {
      if (err) return reject(err);
      db.get(`SELECT * FROM reports WHERE id = ?`, [report_id], (e, r) => e ? reject(e) : resolve(r));
    });
  });
}

export function countByStatusBetween(fromTs, toTs) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending
       FROM reports
       WHERE created_at BETWEEN ? AND ?`,
      [fromTs, toTs],
      (err, row) => (err ? reject(err) : resolve(row || { approved:0, rejected:0, pending:0 }))
    );
  });
}
