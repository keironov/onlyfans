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
        instagram_username TEXT DEFAULT '',
        created_at INTEGER DEFAULT 0
      )
    `);

    // Reports table with enhanced fields
    db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        text TEXT,
        report_date TEXT,
        created_at INTEGER,
        status TEXT DEFAULT 'pending',
        happn_accounts INTEGER DEFAULT 0,
        leads_converted INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Manager notes table
    db.run(`
      CREATE TABLE IF NOT EXISTS manager_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        note TEXT,
        created_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Personal notes table (sticky notes)
    db.run(`
      CREATE TABLE IF NOT EXISTS personal_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        color TEXT DEFAULT 'yellow',
        completed INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
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

    // Work log table
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

    // Insights table
    db.run(`
      CREATE TABLE IF NOT EXISTS insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        category TEXT,
        user_id INTEGER,
        created_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
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

export function updateUserInstagram(userId, instagram) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET instagram_username = ? WHERE id = ?`,
      [instagram, userId],
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

export function addReport({ user_id, text, report_date, created_at }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO reports (user_id, text, report_date, created_at)
       VALUES (?, ?, ?, ?)`,
      [user_id, text, report_date, created_at],
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
      `SELECT reports.*, users.username, users.instagram_username
       FROM reports 
       LEFT JOIN users ON users.id = reports.user_id
       ORDER BY reports.id DESC 
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function updateReportStatus(id, status, happn_accounts = 0, leads_converted = 0, report_date = null) {
  return new Promise((resolve, reject) => {
    let query = `UPDATE reports SET status = ?, happn_accounts = ?, leads_converted = ?`;
    let params = [status, happn_accounts, leads_converted];
    
    if (report_date) {
      query += `, report_date = ?`;
      params.push(report_date);
    }
    
    query += ` WHERE id = ?`;
    params.push(id);
    
    db.run(query, params, function (err) {
      if (err) return reject(err);
      db.get(
        `SELECT reports.*, users.username, users.instagram_username
         FROM reports
         LEFT JOIN users ON users.id = reports.user_id
         WHERE reports.id = ?`,
        [id],
        (e, row) => (e ? reject(e) : resolve(row))
      );
    });
  });
}

// === MANAGER NOTES ===

export function addManagerNote({ user_id, note }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO manager_notes (user_id, note, created_at) VALUES (?, ?, ?)`,
      [user_id, note, Date.now()],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM manager_notes WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listManagerNotes(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM manager_notes WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function deleteManagerNote(noteId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM manager_notes WHERE id = ?`, [noteId], (err) =>
      err ? reject(err) : resolve({ ok: true })
    );
  });
}

// === PERSONAL NOTES (STICKY NOTES) ===

export function addPersonalNote({ content, color }) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    db.run(
      `INSERT INTO personal_notes (content, color, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [content, color, now, now],
      function (err) {
        if (err) return reject(err);
        db.get(`SELECT * FROM personal_notes WHERE id = ?`, [this.lastID], (e, r) =>
          e ? reject(e) : resolve(r)
        );
      }
    );
  });
}

export function listPersonalNotes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM personal_notes ORDER BY completed ASC, created_at DESC`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function togglePersonalNote(noteId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM personal_notes WHERE id = ?`, [noteId], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error('Note not found'));
      
      const newCompleted = row.completed ? 0 : 1;
      db.run(
        `UPDATE personal_notes SET completed = ?, updated_at = ? WHERE id = ?`,
        [newCompleted, Date.now(), noteId],
        function (err2) {
          if (err2) return reject(err2);
          db.get(`SELECT * FROM personal_notes WHERE id = ?`, [noteId], (e, r) =>
            e ? reject(e) : resolve(r)
          );
        }
      );
    });
  });
}

export function deletePersonalNote(noteId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM personal_notes WHERE id = ?`, [noteId], (err) =>
      err ? reject(err) : resolve({ ok: true })
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

// === WORK LOGS ===

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

export function listWorkLogsByDate(date) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT work_logs.*, users.username, users.display_name
       FROM work_logs
       LEFT JOIN users ON users.id = work_logs.user_id
       WHERE work_logs.date = ?
       ORDER BY work_logs.created_at DESC`,
      [date],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === INSIGHTS ===

export function addInsight({ content, category, user_id }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO insights (content, category, user_id, created_at) VALUES (?, ?, ?, ?)`,
      [content, category, user_id || null, Date.now()],
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
      `SELECT insights.*, users.username
       FROM insights
       LEFT JOIN users ON users.id = insights.user_id
       ORDER BY created_at DESC LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === STATISTICS ===

export function getDetailedStats() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.role,
         users.instagram_username,
         COUNT(reports.id) AS total_reports,
         SUM(CASE WHEN reports.status = 'approved' THEN 1 ELSE 0 END) AS approved_reports,
         SUM(CASE WHEN reports.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_reports,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id
       GROUP BY users.id
       ORDER BY approved_reports DESC`,
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getStatsByDateRange(startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.role,
         users.instagram_username,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id AND reports.report_date >= ? AND reports.report_date <= ?
       GROUP BY users.id
       ORDER BY happn_total DESC`,
      [startDate, endDate],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getStatsByUser(userId, startDate = null, endDate = null) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        reports.report_date,
        SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_accounts,
        SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_converted
      FROM reports
      WHERE reports.user_id = ?
    `;
    
    let params = [userId];
    
    if (startDate && endDate) {
      query += ` AND reports.report_date >= ? AND reports.report_date <= ?`;
      params.push(startDate, endDate);
    }
    
    query += ` GROUP BY reports.report_date ORDER BY reports.report_date DESC`;
    
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

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

export function getHappnGrowth(startDate = null, endDate = null) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        report_date as date,
        SUM(happn_accounts) as total
      FROM reports
      WHERE status = 'approved'
    `;
    
    let params = [];
    
    if (startDate && endDate) {
      query += ` AND report_date >= ? AND report_date <= ?`;
      params.push(startDate, endDate);
    }
    
    query += ` GROUP BY report_date ORDER BY report_date ASC`;
    
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

export function getLeadsGrowth(startDate = null, endDate = null) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        report_date as date,
        SUM(leads_converted) as total
      FROM reports
      WHERE status = 'approved'
    `;
    
    let params = [];
    
    if (startDate && endDate) {
      query += ` AND report_date >= ? AND report_date <= ?`;
      params.push(startDate, endDate);
    }
    
    query += ` GROUP BY report_date ORDER BY report_date ASC`;
    
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

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

export function getDailyStats(date) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.instagram_username,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_accounts,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_converted
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id AND reports.report_date = ?
       GROUP BY users.id
       ORDER BY happn_accounts DESC`,
      [date],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

// === RANKINGS ===

export function getRankingByDate(date) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.role,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_total,
         (SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) + 
          SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END)) AS total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id AND reports.report_date = ?
       GROUP BY users.id
       HAVING total > 0
       ORDER BY total DESC
       LIMIT 5`,
      [date],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getRankingByPeriod(startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
         users.id,
         users.username,
         users.role,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) AS happn_total,
         SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END) AS leads_total,
         (SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) + 
          SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END)) AS total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id 
         AND reports.report_date >= ? 
         AND reports.report_date <= ?
       GROUP BY users.id
       HAVING total > 0
       ORDER BY total DESC
       LIMIT 5`,
      [startDate, endDate],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

export function getTop5Trend() {
  return new Promise((resolve, reject) => {
    // Get last 7 days
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    
    // Get top 5 users overall
    db.all(
      `SELECT 
         users.id,
         users.username,
         (SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) + 
          SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END)) AS total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id
       GROUP BY users.id
       ORDER BY total DESC
       LIMIT 5`,
      (err, topUsers) => {
        if (err) return reject(err);
        
        const userPromises = topUsers.map(user => {
          return new Promise((res, rej) => {
            const dataPromises = dates.map(date => {
              return new Promise((r, rj) => {
                db.get(
                  `SELECT 
                     (SUM(CASE WHEN status = 'approved' THEN happn_accounts ELSE 0 END) + 
                      SUM(CASE WHEN status = 'approved' THEN leads_converted ELSE 0 END)) AS total
                   FROM reports
                   WHERE user_id = ? AND report_date = ?`,
                  [user.id, date],
                  (e, row) => e ? rj(e) : r(row ? row.total || 0 : 0)
                );
              });
            });
            
            Promise.all(dataPromises)
              .then(data => res({ username: user.username, data }))
              .catch(rej);
          });
        });
        
        Promise.all(userPromises)
          .then(users => resolve({ dates, users }))
          .catch(reject);
      }
    );
  });
}

export function getAchievements() {
  return new Promise((resolve, reject) => {
    const achievements = [];
    
    // Get top performer
    db.get(
      `SELECT 
         users.username,
         (SUM(CASE WHEN reports.status = 'approved' THEN reports.happn_accounts ELSE 0 END) + 
          SUM(CASE WHEN reports.status = 'approved' THEN reports.leads_converted ELSE 0 END)) AS total
       FROM users
       LEFT JOIN reports ON reports.user_id = users.id
       GROUP BY users.id
       ORDER BY total DESC
       LIMIT 1`,
      (err, topUser) => {
        if (err) return reject(err);
        
        if (topUser && topUser.total > 0) {
          achievements.push({
            icon: '🏆',
            title: 'Топ исполнитель',
            description: `${topUser.username} лидирует с ${topUser.total} выполненными задачами!`
          });
        }
        
        // Get most consistent
        db.get(
          `SELECT 
             users.username,
             COUNT(DISTINCT reports.report_date) AS days_active
           FROM users
           LEFT JOIN reports ON reports.user_id = users.id AND reports.status = 'approved'
           GROUP BY users.id
           ORDER BY days_active DESC
           LIMIT 1`,
          (err2, consistent) => {
            if (err2) return reject(err2);
            
            if (consistent && consistent.days_active > 5) {
              achievements.push({
                icon: '🔥',
                title: 'Самый стабильный',
                description: `${consistent.username} работал ${consistent.days_active} дней подряд!`
              });
            }
            
            // Get team total
            db.get(
              `SELECT 
                 (SUM(CASE WHEN status = 'approved' THEN happn_accounts ELSE 0 END) + 
                  SUM(CASE WHEN status = 'approved' THEN leads_converted ELSE 0 END)) AS team_total
               FROM reports`,
              (err3, teamStats) => {
                if (err3) return reject(err3);
                
                if (teamStats && teamStats.team_total > 100) {
                  achievements.push({
                    icon: '🎯',
                    title: 'Командное достижение',
                    description: `Команда выполнила ${teamStats.team_total} задач вместе!`
                  });
                }
                
                resolve(achievements);
              }
            );
          }
        );
      }
    );
  });
}