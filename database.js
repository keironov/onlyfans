import Database from 'better-sqlite3';
const db = new Database('database.db');

// ------------------ Таблицы ------------------
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  total_reports INTEGER DEFAULT 0,
  da_count INTEGER DEFAULT 0,
  net_count INTEGER DEFAULT 0,
  avg_length REAL DEFAULT 0,
  repeats INTEGER DEFAULT 0,
  types_json TEXT,
  last_report TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  message TEXT,
  date TEXT,
  checked TEXT,
  task_type TEXT,
  suspicious INTEGER DEFAULT 0
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  from_admin TEXT,
  message TEXT,
  date TEXT,
  delivered INTEGER DEFAULT 0
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS activity_heat (
  username TEXT,
  day INTEGER,
  hour INTEGER,
  count INTEGER DEFAULT 0,
  PRIMARY KEY(username,day,hour)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS user_metrics (
  username TEXT PRIMARY KEY,
  total_reports INTEGER DEFAULT 0,
  da_count INTEGER DEFAULT 0,
  net_count INTEGER DEFAULT 0,
  repeats INTEGER DEFAULT 0,
  avg_length REAL DEFAULT 0,
  types_json TEXT,
  last_report TEXT
)
`).run();

export default db;
