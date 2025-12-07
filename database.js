import Database from 'better-sqlite3';
const db = new Database('database.db');

// ------------------ Таблицы пользователей ------------------
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  total_reports INTEGER DEFAULT 0,
  da_count INTEGER DEFAULT 0,
  net_count INTEGER DEFAULT 0,
  avg_length REAL DEFAULT 0,
  repeats INTEGER DEFAULT 0,
  types_json TEXT, -- JSON для подсчета задач: {accounts:0, chat:0, to_ig:0}
  last_report TEXT
)
`).run();

// ------------------ Таблица отчетов ------------------
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

// ------------------ Таблица фидбека ------------------
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

// ------------------ Таблица активности (тепловая карта) ------------------
db.prepare(`
CREATE TABLE IF NOT EXISTS activity_heat (
  username TEXT,
  day INTEGER,   -- 0=Воскресенье ... 6=Суббота
  hour INTEGER,  -- 0..23
  count INTEGER DEFAULT 0,
  PRIMARY KEY (username, day, hour)
)
`).run();

// ------------------ Таблица системных уведомлений ------------------
db.prepare(`
CREATE TABLE IF NOT EXISTS system_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  notice_type TEXT,
  message TEXT,
  date TEXT,
  delivered INTEGER DEFAULT 0
)
`).run();

// ------------------ Таблица архива ------------------
db.prepare(`
CREATE TABLE IF NOT EXISTS reports_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  message TEXT,
  date TEXT,
  checked TEXT,
  task_type TEXT,
  suspicious INTEGER DEFAULT 0
)
`).run();

// ------------------ Таблица метрик для расширенной аналитики ------------------
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

// ------------------ Функции для работы с базой ------------------

export function addUser(username){
  const exists = db.prepare("SELECT 1 FROM users WHERE username=?").get(username);
  if(!exists){
    db.prepare("INSERT INTO users(username) VALUES(?)").run(username);
    db.prepare("INSERT INTO user_metrics(username) VALUES(?)").run(username);
  }
}

export function addReport(username, message, date){
  // определяем тип задачи
  const task_type = classifyTask(message);
  // проверка подозрительности
  const {suspicious} = detectSuspicious(username, message);

  db.prepare("INSERT INTO reports(username,message,date,task_type,suspicious) VALUES(?,?,?,?,?)")
    .run(username, message, date, task_type, suspicious);

  // обновляем активность пользователя
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  const total_reports = (user?.total_reports||0)+1;
  const avg_length = user?.avg_length ? ((user.avg_length*user.total_reports + message.length)/total_reports) : message.length;

  // обновляем тип задач
  let types = user?.types_json ? JSON.parse(user.types_json) : {accounts:0, chat:0, to_ig:0};
  if(task_type && types[task_type] !== undefined) types[task_type]++;

  db.prepare(`
    UPDATE users SET 
      total_reports=?, 
      avg_length=?, 
      types_json=?,
      last_report=?
    WHERE username=?
  `).run(total_reports, avg_length, JSON.stringify(types), date, username);

  // обновляем user_metrics
  db.prepare(`
    UPDATE user_metrics SET
      total_reports=?,
      avg_length=?,
      types_json=?,
      last_report=?
    WHERE username=?
  `).run(total_reports, avg_length, JSON.stringify(types), date, username);

  // обновляем тепловую карту
  updateActivityHeat(username, date);
}

// ------------------ Функция классификации задач ------------------
function classifyTask(message){
  message = message.toLowerCase();
  if(message.match(/аккаунт|happn/)) return "accounts";
  if(message.match(/чат|писал|отвечал/)) return "chat";
  if(message.match(/перевёл|отправил|инста/)) return "to_ig";
  return "other";
}

// ------------------ Функция детектора подозрительности ------------------
function detectSuspicious(username, message){
  let suspicious = false;
  // короткие сообщения
  if(message.length < 15) suspicious = true;
  // повторяющиеся шаблоны
  if(message.match(/делал аккаунт(ов)?/gi)) suspicious = true;
  return {suspicious};
}

// ------------------ Функция обновления тепловой карты ------------------
function updateActivityHeat(username, dateStr){
  const date = new Date(dateStr);
  const day = date.getDay();
  const hour = date.getHours();

  const row = db.prepare("SELECT count FROM activity_heat WHERE username=? AND day=? AND hour=?").get(username, day, hour);
  if(row) db.prepare("UPDATE activity_heat SET count=count+1 WHERE username=? AND day=? AND hour=?").run(username, day, hour);
  else db.prepare("INSERT INTO activity_heat(username,day,hour,count) VALUES(?,?,?,1)").run(username, day, hour);
}

// ------------------ Функции для фидбека ------------------
export function addFeedback(username, from_admin, message){
  db.prepare("INSERT INTO feedback(username, from_admin, message, date, delivered) VALUES(?,?,?,?,0)")
    .run(username, from_admin, message, new Date().toISOString());
}

// ------------------ Функции для архива ------------------
export function archiveOldReports(days=30){
  const cutoff = new Date(Date.now() - days*24*3600*1000).toISOString();
  const oldReports = db.prepare("SELECT * FROM reports WHERE date<?").all(cutoff);
  const insert = db.prepare("INSERT INTO reports_archive(username,message,date,checked,task_type,suspicious) VALUES(?,?,?,?,?,?)");
  const del = db.prepare("DELETE FROM reports WHERE date<?");
  const tran = db.transaction(()=>{
    oldReports.forEach(r=>insert.run(r.username,r.message,r.date,r.checked,r.task_type,r.suspicious));
    del.run(cutoff);
  });
  tran();
}

// ------------------ Функция для расчета KPI ------------------
export function computeKPI({total_reports, da_count, net_count, repeats, avg_length, types}){
  const da_percent = total_reports ? da_count/total_reports : 0;
  const net_percent = total_reports ? net_count/total_reports : 0;
  const diversity = Object.values(types||{accounts:0,chat:0,to_ig:0}).filter(v=>v>0).length;
  const kpi = (da_percent * total_reports * diversity) - repeats - net_percent*total_reports;
  return kpi;
}

// ------------------ Функции для получения данных ------------------
export function getUsers(){
  return db.prepare("SELECT * FROM users").all();
}

export function getReports(){
  return db.prepare("SELECT * FROM reports ORDER BY date DESC LIMIT 100").all();
}

export function getActivityHeat(){
  return db.prepare("SELECT * FROM activity_heat").all();
}

export function getUserMetrics(username){
  return db.prepare("SELECT * FROM user_metrics WHERE username=?").get(username);
}

export default db;
