// database.js
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_PATH);

function init() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      display_name TEXT,
      telegram_id TEXT,
      joined_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      text TEXT,
      created_at INTEGER,
      task_type TEXT,
      length INTEGER,
      suspicious INTEGER DEFAULT 0,
      repeat_score REAL DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      manager_id TEXT,
      message TEXT,
      created_at INTEGER,
      seen INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  });
}

// helper: run/ get/ all as Promise
function run(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* Users */
async function ensureUserByTelegram(telegram_id, username, display_name) {
  let user = await get(`SELECT * FROM users WHERE telegram_id = ?`, [telegram_id]);
  if (user) return user;
  const id = uuidv4();
  const joined_at = Date.now();
  await run(`INSERT INTO users (id, username, display_name, telegram_id, joined_at) VALUES (?,?,?,?,?)`,
    [id, username || null, display_name || null, telegram_id, joined_at]);
  return { id, username, display_name, telegram_id, joined_at };
}

async function getUserByUsername(username) {
  return get(`SELECT * FROM users WHERE username = ?`, [username]);
}

async function getUserById(id) {
  return get(`SELECT * FROM users WHERE id = ?`, [id]);
}

async function listUsers() {
  return all(`SELECT id, username, display_name, telegram_id, joined_at FROM users ORDER BY joined_at DESC`);
}

/* Reports */
async function addReport({ user_id, text, created_at = Date.now() }) {
  // simple auto-classify and detectors
  const id = uuidv4();
  const length = text.length;
  const task_type = classifyTask(text);
  const suspicious = isSuspicious(text) ? 1 : 0;
  const repeat_score = await calcRepeatScore(user_id, text);

  await run(`INSERT INTO reports (id,user_id,text,created_at,task_type,length,suspicious,repeat_score)
    VALUES (?,?,?,?,?,?,?,?)`, [id, user_id, text, created_at, task_type, length, suspicious, repeat_score]);

  return { id, user_id, text, created_at, task_type, length, suspicious, repeat_score };
}

async function listReportsForUser(user_id, limit=100) {
  return all(`SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [user_id, limit]);
}

async function listReports(limit=500) {
  return all(`SELECT r.*, u.username FROM reports r LEFT JOIN users u ON r.user_id = u.id ORDER BY created_at DESC LIMIT ?`, [limit]);
}

/* Feedback */
async function addFeedback({ user_id, manager_id, message, created_at = Date.now() }) {
  const id = uuidv4();
  await run(`INSERT INTO feedback (id,user_id,manager_id,message,created_at,seen) VALUES (?,?,?,?,?,0)`, [id, user_id, manager_id, message, created_at]);
  return { id, user_id, manager_id, message, created_at };
}

async function listFeedback(user_id=null) {
  if (user_id) {
    return all(`SELECT f.*, u.username as user_name, m.username as manager_name
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      LEFT JOIN users m ON f.manager_id = m.id
      WHERE f.user_id = ?
      ORDER BY created_at DESC`, [user_id]);
  } else {
    return all(`SELECT f.*, u.username as user_name, m.username as manager_name
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      LEFT JOIN users m ON f.manager_id = m.id
      ORDER BY created_at DESC`);
  }
}

/* Analytics helpers */
function classifyTask(text) {
  text = (text || '').toLowerCase();
  if (/аккаунт|happn|созда/i.test(text)) return 'accounts';
  if (/чат|писал|ответ|чатинг/i.test(text)) return 'chat';
  if (/перевел|инста|insta|instagram/i.test(text)) return 'transfers';
  if (/ничего|нет/i.test(text)) return 'skip';
  // fallback: detect multiple keywords
  return 'other';
}

function isSuspicious(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true; // too short
  // repeated template-like words:
  const repeatedSeq = /(делал аккаунты|проверял|писал людям)/i;
  if (repeatedSeq.test(text)) return true;
  return false;
}

async function calcRepeatScore(user_id, text) {
  // naive: compare with last 5 reports, compute fraction of identical sentences
  const recent = await all(`SELECT text FROM reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [user_id]);
  if (!recent || recent.length === 0) return 0;
  const base = normalizeText(text);
  let matches = 0;
  for (const r of recent) {
    if (!r.text) continue;
    const t = normalizeText(r.text);
    if (t === base) matches++;
  }
  return matches / recent.length;
}

function normalizeText(txt) {
  return (txt || '').toLowerCase().replace(/\s+/g,' ').trim();
}

/* Analytics endpoints (summaries) */
async function summaryForUser(user_id) {
  const reports = await listReportsForUser(user_id, 1000);
  const count = reports.length;
  const suspicious_count = reports.filter(r=>r.suspicious).length;
  const avg_length = reports.reduce((s,r)=>s+(r.length||0),0) / Math.max(1, count);
  // activity by day (last 30 days)
  const last30 = {};
  const now = Date.now();
  const dayMs = 24*60*60*1000;
  for (let i=0;i<30;i++) {
    const t = new Date(now - i*dayMs).toISOString().slice(0,10);
    last30[t]=0;
  }
  for (const r of reports) {
    const day = new Date(r.created_at).toISOString().slice(0,10);
    if (last30[day] !== undefined) last30[day]++;
  }
  // task distribution
  const taskDist = {};
  for (const r of reports) {
    taskDist[r.task_type] = (taskDist[r.task_type]||0)+1;
  }
  // simple indexes
  const DApercent = Math.max(0, Math.round((count/30)*100)); // naive: reports per 30 days -> percent
  const NETpercent = Math.round((suspicious_count / Math.max(1,count)) * 100);
  const usefulIndex = Math.round((DApercent * (1 - NETpercent/100)) + avg_length/10);

  return {
    count, suspicious_count, avg_length, last30, taskDist, DApercent, NETpercent, usefulIndex
  };
}

async function globalSummary() {
  const users = await listUsers();
  const reports = await listReports(1000);
  // top performers by count
  const byUser = {};
  for (const r of reports) {
    byUser[r.user_id] = (byUser[r.user_id]||0)+1;
  }
  // convert
  const leaderboard = Object.entries(byUser).map(([uid, cnt]) => ({ user_id: uid, count: cnt }));
  leaderboard.sort((a,b)=>b.count-a.count);
  return { usersCount: users.length, reportsCount: reports.length, leaderboard };
}

module.exports = {
  init, run, get, all,
  ensureUserByTelegram, getUserByUsername, getUserById, listUsers,
  addReport, listReportsForUser, listReports,
  addFeedback, listFeedback,
  summaryForUser, globalSummary
};
