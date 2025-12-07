import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function detectSuspicious(message){
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

function computeKPI(user){
  const total_reports = user.total_reports || 0;
  const da_percent = total_reports ? (user.da_count/total_reports) : 0;
  const net_percent = total_reports ? (user.net_count/total_reports) : 0;
  const types = user.types_json ? JSON.parse(user.types_json) : {accounts:0,chat:0,to_ig:0};
  const diversity = Object.values(types).filter(v=>v>0).length;
  const repeats = user.repeats || 0;
  const kpi = (da_percent * total_reports * diversity) - repeats - net_percent*total_reports;
  return kpi;
}

function addReport(username, message, date){
  addUser(username);
  const task_type = classifyTask(message);
  const {suspicious} = detectSuspicious(message);

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

// ------------------ API ------------------
app.get('/api/analytics', (req,res)=>{
  const users = db.prepare("SELECT * FROM users").all();
  const taskCounts = {};
  db.prepare("SELECT task_type, COUNT(*) AS count FROM reports GROUP BY task_type")
    .all().forEach(r => taskCounts[r.task_type] = r.count);
  const recommendations = ["Проверить DA/NET","Сбалансировать задачи","Проверить короткие отчёты"];
  res.json({users, taskCounts, recommendations});
});

app.get('/api/extended_analytics', (req,res)=>{
  const heat = db.prepare("SELECT username, hour, count FROM activity_heat").all();
  res.json({heat});
});

app.get('/api/user/:username', (req,res)=>{
  const username = req.params.username;
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if(!user) return res.status(404).json({error:"User not found"});
  const reports = db.prepare("SELECT * FROM reports WHERE username=? ORDER BY date DESC LIMIT 100").all(username);
  const kpi = computeKPI(user);
  res.json({user,reports,kpi});
});

app.post('/api/feedback', (req,res)=>{
  const {username,message,from_admin} = req.body;
  if(!username||!message) return res.status(400).json({error:"Missing fields"});
  db.prepare("INSERT INTO feedback(username,message,from_admin,date,delivered) VALUES(?,?,?,?,0)")
    .run(username,message,from_admin,new Date().toISOString());
  res.json({success:true});
});

// ------------------ Telegram Bot ------------------
if(!process.env.BOT_TOKEN || !process.env.BOT_ADMIN_ID){
  console.error("Не заданы BOT_TOKEN или BOT_ADMIN_ID в .env");
} else {
  const bot = new TelegramBot(process.env.BOT_TOKEN,{polling:true});
  const botAdmin = process.env.BOT_ADMIN_ID;

  bot.sendMessage(botAdmin, '🤖 Бот успешно запущен!');

  bot.onText(/\/start/, (msg)=>{
    bot.sendMessage(msg.chat.id, `Привет! Твой ID: ${msg.chat.id}`);
  });

  bot.onText(/\/ping/, (msg)=>{
    bot.sendMessage(msg.chat.id, 'Pong 🏓');
  });

  bot.on('message', msg=>{
    if(msg.text && !msg.text.startsWith('/')){ // все обычные сообщения
      const username = msg.from.username || msg.from.first_name || "unknown";
      const text = msg.text;
      const date = new Date().toISOString();
      addReport(username, text, date);
      bot.sendMessage(msg.chat.id, `Принял сообщение: "${text}"`);
    }
  });
}

// ------------------ Запуск ------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
