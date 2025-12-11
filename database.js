import sqlite3 from "sqlite3";
import { open } from "sqlite";

let db;

export async function initDB() {
  db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      wallet TEXT,
      created_at INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      number INTEGER DEFAULT 0,
      type TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      timestamp INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS global_stats (
      key TEXT PRIMARY KEY,
      value INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      message TEXT,
      date INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      start INTEGER,
      end INTEGER
    )
  `);

  // Инициализация глобальной статистики
  await db.run(`INSERT OR IGNORE INTO global_stats (key, value) VALUES ('today_profit', 0)`);
  await db.run(`INSERT OR IGNORE INTO global_stats (key, value) VALUES ('week_profit', 0)`);
  await db.run(`INSERT OR IGNORE INTO global_stats (key, value) VALUES ('month_profit', 0)`);
  await db.run(`INSERT OR IGNORE INTO global_stats (key, value) VALUES ('total_users', 0)`);

  return db;
}

// ===============================================
// USERS
// ===============================================

export function addUser(username, wallet) {
  return db.run(
    `INSERT INTO users (username, wallet, created_at) VALUES (?, ?, ?)`,
    [username, wallet, Date.now()]
  );
}

export function listUsers() {
  return db.all(`SELECT * FROM users ORDER BY id DESC`);
}

export function getUser(id) {
  return db.get(`SELECT * FROM users WHERE id = ?`, [id]);
}

export function countUsers() {
  return db.get(`SELECT COUNT(*) AS total FROM users`);
}

// ===============================================
// REPORTS
// ===============================================

export function addReport(user_id, number, type) {
  return new Promise((resolve, reject) => {
    const ts = Date.now();

    db.run(
      `INSERT INTO reports (user_id, number, type, status, timestamp)
       VALUES (?, ?, ?, 'pending', ?)`,
      [user_id, number, type, ts],
      function (err) {
        if (err) return reject(err);

        db.get(
          `SELECT reports.*, users.username
           FROM reports
           LEFT JOIN users ON users.id = reports.user_id
           WHERE reports.id = ?`,
          [this.lastID],
          (e, row) => (e ? reject(e) : resolve(row))
        );
      }
    );
  });
}

export function listReports() {
  return db.all(`
    SELECT reports.*, users.username
    FROM reports
    LEFT JOIN users ON reports.user_id = users.id
    ORDER BY reports.id DESC
  `);
}

export function getReport(id) {
  return db.get(
    `SELECT reports.*, users.username
     FROM reports
     LEFT JOIN users ON users.id = reports.user_id
     WHERE reports.id = ?`,
    [id]
  );
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

// ===============================================
// FEEDBACK
// ===============================================

export function addFeedback(name, message) {
  return db.run(
    `INSERT INTO feedback (name, message, date) VALUES (?, ?, ?)`,
    [name, message, Date.now()]
  );
}

export function listFeedback() {
  return db.all(`SELECT * FROM feedback ORDER BY id DESC`);
}

// ===============================================
// GLOBAL STATS
// ===============================================

export function getStats() {
  return db.all(`SELECT key, value FROM global_stats`);
}

export function incrementStat(key, amount) {
  return db.run(
    `UPDATE global_stats SET value = value + ? WHERE key = ?`,
    [amount, key]
  );
}

export function setStat(key, value) {
  return db.run(
    `UPDATE global_stats SET value = ? WHERE key = ?`,
    [value, key]
  );
}

// ===============================================
// PERIODS
// ===============================================

export function getPeriods() {
  return db.all(`SELECT * FROM periods`);
}

export function createPeriod(type, start, end) {
  return db.run(
    `INSERT INTO periods (type, start, end) VALUES (?, ?, ?)`,
    [type, start, end]
  );
}

// Проверка и автосоздание периода
export async function ensurePeriod(type, start, end) {
  const existing = await db.get(
    `SELECT * FROM periods WHERE type = ? AND start = ? AND end = ?`,
    [type, start, end]
  );

  if (!existing) {
    await createPeriod(type, start, end);
  }
}

