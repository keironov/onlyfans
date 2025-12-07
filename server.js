import express from 'express';
import bodyParser from 'body-parser';
import TelegramBot from 'node-telegram-bot-api';
import Database from 'better-sqlite3';

const app = express();
app.use(bodyParser.json());

const db = new Database('database.db');

// ------------------ Создание таблиц ------------------
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
  PRIMARY KEY (username, day, hour)
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

// ------------------ Функции ------------------
function addUser(username){
  const exists = db.prepare("SELECT 1 FROM users WHERE username=?").get(username);
  if(!exists){
    db.prepare("INSERT INTO users(username) VALUES(?)").run(username);
    db.prepare("INSERT INTO user_metrics(username) VALUES(?)").run(username);
  }
}

function classifyTask(message){
  message = message.toLowerCase();
  if(message.match(/аккаунт|happn/)) return "accounts";
  if(message.match(/чат|писал|отвечал/)) return "chat";
  if(message.match(/перевёл|отправил|инста/)) return "to_ig";
  return "other";
}

function detectSuspicious(username, message){
  let suspicious = 0;
  if(message.length < 15) suspicious = 1;
  if(message.match(/делал аккаунт(ов)?/gi)) suspicious = 1;
  return {suspicious};
}

function updateActivityHeat(username, dateStr){
  const date = new Date(dateStr);
  const day = date.getDay();
  const hour = date.getHours();

  const row = db.prepare("SELECT count FROM activity_heat WHERE username=? AND day=? AND hour=?").get(username, day, hour);
  if(row) db.prepare("UPDATE activity_heat SET count=count+1 WHERE username=? AND day=? AND hour=?").run(username, day, hour);
  else db.prepare("INSERT INTO activity_heat(username,day,hour,count) VALUES(?,?,?,1)").run(username, day, hour);
}

function addReport(username, message, date){
  addUser(username);
  const task_type = classifyTask(message);
  const {suspicious} = detectSuspicious(username, message);

  db.prepare("INSERT INTO reports(username,message,date,task_type,suspicious) VALUES(?,?,?,?,?)")
    .run(username, message, date, task_type, suspicious);

  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  const total_reports = (user?.total_reports||0)+1;
  const avg_length = user?.avg_length ? ((user.avg_length*user.total_reports + message.length)/total_reports) : message.length;

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

  db.prepare(`
    UPDATE user_metrics SET
      total_reports=?,
      avg_length=?,
      types_json=?,
      last_report=?
    WHERE username=?
  `).run(total_reports, avg_length, JSON.stringify(types), date, username);

  updateActivityHeat(username, date);
}

// ------------------ Telegram Bot ------------------
const TOKEN = '8543977197:AAGZaAEgv-bXYKMLN3KmuFn15i4geOGBBDI';
const bot = new TelegramBot(TOKEN, {polling: true});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || "unknown";
  const text = msg.text;
  const date = new Date().toISOString();

  // Сохраняем в базу
  addReport(username, text, date);

  // Отвечаем пользователю
  bot.sendMessage(chatId, `Принял твоё сообщение: "${text}"`);
});

// ------------------ Express server ------------------
app.get('/', (req, res) => res.send('Server is running!'));
app.listen(10000, () => console.log('Server running on port 10000'));
