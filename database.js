// database.js
import sqlite3pkg from 'sqlite3';
const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database('./database.sqlite');

// --- Создание таблиц при старте ---
db.serialize(() => {
  // Таблица пользователей
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT UNIQUE,
      balance REAL DEFAULT 0
    )
  `);

  // Таблица репортов
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      text TEXT,
      status INTEGER DEFAULT 0,
      source TEXT DEFAULT 'telegram',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Таблица выплат
  db.run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount REAL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // --- Проверка и добавление новых колонок для совместимости ---
  db.all("PRAGMA table_info(reports)", (err, rows) => {
    if (err) return console.error(err);
    const cols = (rows || []).map(r => r.name);

    if (!cols.includes('status')) {
      db.run("ALTER TABLE reports ADD COLUMN status INTEGER DEFAULT 0");
    }
    if (!cols.includes('source')) {
      db.run("ALTER TABLE reports ADD COLUMN source TEXT DEFAULT 'telegram'");
    }
  });
});

// --- Функции работы с базой ---

export function ensureUserByTelegram(telegram_id, username) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE telegram_id = ?", [telegram_id], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      db.run(
        "INSERT INTO users (telegram_id, username) VALUES (?, ?)",
        [telegram_id, username],
        function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, telegram_id, username, balance: 0 });
        }
      );
    });
  });
}

export function addReport(user_id, text, source = 'telegram') {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO reports (user_id, text, source) VALUES (?, ?, ?)",
      [user_id, text, source],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, user_id, text, status: 0, source });
      }
    );
  });
}

export function getUserReports(user_id) {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM reports WHERE user_id = ?", [user_id], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export function addPayout(user_id, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO payouts (user_id, amount) VALUES (?, ?)",
      [user_id, amount],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, user_id, amount, status: 'pending' });
      }
    );
  });
}

export function updateUserBalance(user_id, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET balance = balance + ? WHERE id = ?",
      [amount, user_id],
      function(err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

export function getUserById(user_id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE id = ?", [user_id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

export function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM users", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export function getAllReports() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM reports", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

export function getAllPayouts() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM payouts", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
