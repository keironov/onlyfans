import sqlite3pkg from 'sqlite3';
const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database('./database.sqlite');

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
        source TEXT,
        status TEXT DEFAULT 'pending',
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

// === USERS ===
export function ensureUserByTelegram(telegram_id, username, display) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegram_id], (err,row)=>{
      if(err) return reject(err);
      if(row) return resolve(row);
      db.run(`INSERT INTO users (telegram_id, username, display_name) VALUES (?,?,?)`, [telegram_id,username,display], function(err2){
        if(err2) return reject(err2);
        db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (e,r)=>e?reject(e):resolve(r));
      });
    });
  });
}

export function getUserByUsername(username){
  return new Promise((resolve,reject)=>{db.get(`SELECT * FROM users WHERE username = ?`,[username],(err,row)=>err?reject(err):resolve(row))});
}
export function listUsers(){
  return new Promise((resolve,reject)=>{db.all(`SELECT * FROM users ORDER BY id DESC`,(err,rows)=>err?reject(err):resolve(rows))});
}

// === REPORTS ===
export function addReport({ user_id, text, created_at, source }) {
  return new Promise((resolve,reject)=>{
    const length = text.length;
    const suspicious = length < 5 ? 1:0;
    const task_type = length<20?'short':'long';
    db.run(`INSERT INTO reports (user_id,text,task_type,length,suspicious,created_at,source) VALUES (?,?,?,?,?,?,?)`,
      [user_id,text,task_type,length,suspicious,created_at,source],
      function(err){
        if(err) return reject(err);
        db.get(`SELECT * FROM reports WHERE id=?`,[this.lastID],(e,r)=>e?reject(e):resolve(r));
      });
  });
}

export function listReports(limit=1000){ return new Promise((resolve,reject)=>{ db.all(`SELECT reports.*, users.username FROM reports LEFT JOIN users ON users.id=reports.user_id ORDER BY reports.id DESC LIMIT ?`,[limit],(err,rows)=>err?reject(err):resolve(rows)); }); }

export function listRecentWebReports(limit=5){
  return new Promise((resolve,reject)=>{
    db.all(`SELECT reports.*, users.username FROM reports LEFT JOIN users ON users.id=reports.user_id WHERE source='web' ORDER BY reports.id DESC LIMIT ?`,[limit],(err,rows)=>err?reject(err):resolve(rows));
  });
}

export function markReportStatus(id,status){ // done / failed
  return new Promise((resolve,reject)=>{
    db.run(`UPDATE reports SET status=? WHERE id=?`,[status,id], function(err){
      if(err) return reject(err);
      db.get(`SELECT * FROM reports WHERE id=?`,[id],(e,r)=>e?reject(e):resolve(r));
    });
  });
}

export function summaryForUser(user_id){
  return new Promise((resolve,reject)=>{
    db.get(`SELECT COUNT(*) AS total,SUM(length) AS total_length,SUM(CASE WHEN suspicious=1 THEN 1 ELSE 0 END) AS suspicious,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM reports WHERE user_id=?`,[user_id],(err,row)=>err?reject(err):resolve(row));
  });
}

// Global
export function globalSummary(){
  return new Promise((resolve,reject)=>{
    db.get(`SELECT COUNT(*) AS reports_total,SUM(length) AS total_length,SUM(CASE WHEN suspicious=1 THEN 1 ELSE 0 END) AS suspicious_total,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done_total,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_total FROM reports`,(err,row)=>err?reject(err):resolve(row));
  });
}

export function globalChartSummary(){ // return green/red for chart
  return new Promise((resolve,reject)=>{
    db.all(`SELECT DATE(created_at/1000,'unixepoch') AS day,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done_count,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_count FROM reports GROUP BY day ORDER BY day DESC`,(err,rows)=>err?reject(err):resolve(rows));
  });
}

// === FEEDBACK ===
export function addFeedback({ user_id, manager_id, message, created_at }){
  return new Promise((resolve,reject)=>{
    db.run(`INSERT INTO feedback (user_id,manager_id,message,created_at) VALUES (?,?,?,?)`,[user_id,manager_id,message,created_at],function(err){if(err) return reject(err);db.get(`SELECT * FROM feedback WHERE id=?`,[this.lastID],(e,r)=>e?reject(e):resolve(r));});
  });
}
export function listFeedback(){
  return new Promise((resolve,reject)=>{
    db.all(`SELECT feedback.*, u.username AS user_name, m.username AS manager_name FROM feedback LEFT JOIN users u ON u.id=feedback.user_id LEFT JOIN users m ON m.id=feedback.manager_id ORDER BY feedback.id DESC`,(err,rows)=>err?reject(err):resolve(rows));
  });
}
