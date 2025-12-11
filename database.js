import sqlite3pkg from 'sqlite3';
const sqlite3 = sqlite3pkg.verbose();

const db = new sqlite3.Database('./database.sqlite');

// === CREATE TABLES ===
export function init() {
  db.serialize(() => {
    // Users table with role field
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT,
        role TEXT DEFAULT '',
        created_at INTEGER DEFAULT 0
      )
    `);

    // Reports table
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

    // Feedback table
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

    // Work log table (Blog feature)
    db.run(`
      CREATE TABLE IF NOT EXISTS work_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        status TEXT,
        reason TEXT,
        created_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Insights/recommendations table
    db.run(`
      CREATE TABLE IF NOT EXISTS insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        category TEXT,
        created_at INTEGER
      )
    `);
  });
}

// === USER MANAGEMENT ===

export function ensureUserByTelegram(telegram_id, username, display) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE telegram_id = ?`,
      [telegram_id],
      (err, row) => {
        if (err) return reject(err);
        if (row) return resolve(row);

        db.run(
          `INSERT INTO users (telegram_id, username, display_name, created_at) VALUES (?, ?, ?, ?)`,
          [telegram_id, username, display, Date.now()],
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

export function addUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (username, display_name, created_at) VALUES (?, ?, ?)`,
      [username, username, Date.now()],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function updateUserRole(userId, role) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET role = ? WHERE id = ?`,
      [role, userId],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function deleteUser(userId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) =>
      err ? reject(err) : resolve({ ok: true })
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

// === REPORTS ===

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

// === FEEDBACK ===

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

// === WORK LOGS (BLOG) ===

export function addWorkLog({ user_id, date, status, reason }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO work_logs (user_id, date, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, date, status, reason, Date.now()],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM work_logs WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listWorkLogs(limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT work_logs.*, users.username, users.display_name
       FROM work_logs
       LEFT JOIN users ON users.id = work_logs.user_id
       ORDER BY work_logs.date DESC, work_logs.created_at DESC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getWorkLogForUserDate(user_id, date) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM work_logs WHERE user_id = ? AND date = ?`,
      [user_id, date],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

// === INSIGHTS ===

export function addInsight({ content, category }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO insights (content, category, created_at) VALUES (?, ?, ?)`,
      [content, category, Date.now()],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM insights WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listInsights(limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM insights ORDER BY created_at DESC LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === STATISTICS ===

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

export function getDetailedStats() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.role,
         COUNT(reports.id) AS total_reports,
         SUM(CASE WHEN reports.status = 'approved' THEN 1 ELSE 0 END) AS approved_reports,
         SUM(CASE WHEN reports.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_reports,
         SUM(CASE WHEN reports.type = 'happn' THEN reports.number ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.type = 'instagram' THEN reports.number ELSE 0 END) AS instagram_total,
         SUM(CASE WHEN reports.type = 'lid' THEN reports.number ELSE 0 END) AS lid_total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id
       GROUP BY users.id
       ORDER BY approved_reports DESC`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === NEW: APPROVAL/REJECTION STATS ===

export function getApprovalStats() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS total_approved,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS total_rejected
       FROM reports`,
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

// === NEW: GROWTH STATISTICS ===

export function getTeamGrowth() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         DATE(created_at / 1000, 'unixepoch') as date,
         COUNT(*) as count
       FROM users
       GROUP BY date
       ORDER BY date ASC`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getConversionGrowth(type) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         DATE(created_at / 1000, 'unixepoch') as date,
         SUM(number) as total
       FROM reports
       WHERE status = 'approved' AND type = ?
       GROUP BY date
       ORDER BY date ASC`,
      [type],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === NEW: ABSENCE RANKING ===

export function getAbsenceRanking() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.display_name,
         COUNT(work_logs.id) as absence_count
       FROM users
       LEFT JOIN work_logs ON work_logs.user_id = users.id AND work_logs.status = 'absent'
       GROUP BY users.id
       HAVING absence_count > 0
       ORDER BY absence_count DESC
       LIMIT 10`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === NEW: INDIVIDUAL USER DETAILED STATS ===

export function getUserDetailedStats(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
         users.id,
         users.username,
         users.display_name,
         users.role,
         COUNT(reports.id) AS total_reports,
         SUM(CASE WHEN reports.status = 'approved' THEN 1 ELSE 0 END) AS approved_reports,
         SUM(CASE WHEN reports.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_reports,
         SUM(CASE WHEN reports.type = 'happn' THEN reports.number ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.type = 'instagram' THEN reports.number ELSE 0 END) AS instagram_total,
         SUM(CASE WHEN reports.type = 'lid' THEN reports.number ELSE 0 END) AS lid_total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id
       WHERE users.id = ?
       GROUP BY users.id`,
      [userId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}