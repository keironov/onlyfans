import express from 'express';
import bodyParser from 'body-parser';
import db, { addUser, addReport, addFeedback, archiveOldReports, computeKPI, getUsers, getReports, getActivityHeat } from './database.js';
import TelegramBot from 'node-telegram-bot-api';

// ------------------ Настройки ------------------
const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const TELEGRAM_TOKEN = '8543977197:AAGZaAEgv-bXYKMLN3KmuFn15i4geOGBBDI';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ------------------ Помощники ------------------

// Авто-замечания (8 пункт)
function autoNotice(username, message){
  const notice = `Авто-замечание: отчет подозрительный или короткий. Пожалуйста, уточни детали.`;
  bot.sendMessage(`@${username}`, notice).catch(console.log);
  addFeedback(username, "system", notice);
}

// ------------------ Telegram бот ------------------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text || "";
  const date = new Date().toISOString();

  addUser(username);
  addReport(username, text, date);

  const {suspicious} = db.prepare("SELECT suspicious FROM reports WHERE username=? ORDER BY id DESC LIMIT 1").get(username);
  if(suspicious){
    autoNotice(username, text);
  }

  bot.sendMessage(chatId, `Отчет получен!${suspicious ? " ⚠️ Подозрительный отчет, авто-замечание отправлено" : ""}`);
});

// ------------------ API для фронтенда ------------------

// 1. Основная аналитика
app.get('/api/analytics', (req,res)=>{
  const users = getUsers();
  const taskCounts = {accounts:0, chat:0, to_ig:0};
  const recommendations = [];

  users.forEach(u=>{
    const types = u.types_json ? JSON.parse(u.types_json) : {accounts:0, chat:0, to_ig:0};
    Object.keys(types).forEach(k=> taskCounts[k] += types[k]);

    if((types.accounts||0) > (types.to_ig||0)*4) recommendations.push(`${u.username}: много аккаунтов, мало переводов`);
    if(u.avg_length < 30) recommendations.push(`${u.username}: короткие отчеты — просить подробнее`);
    if(u.net_count > u.da_count) recommendations.push(`${u.username}: качество отчетов низкое`);
  });

  res.json({users, taskCounts, recommendations});
});

// 2. Расширенная аналитика + KPI
app.get('/api/extended_analytics', (req,res)=>{
  const heat = getActivityHeat();
  const users = getUsers().map(u=>{
    const types = u.types_json ? JSON.parse(u.types_json) : {accounts:0, chat:0, to_ig:0};
    const kpi = computeKPI({
      total_reports: u.total_reports,
      da_count: u.da_count,
      net_count: u.net_count,
      repeats: u.repeats,
      avg_length: u.avg_length,
      types
    });
    return {...u, types, kpi};
  });

  const recommendations = [];
  users.forEach(u=>{
    if((u.types.accounts||0) > (u.types.to_ig||0)*4) recommendations.push(`${u.username}: много аккаунтов, мало переводов`);
    if(u.avg_length<30) recommendations.push(`${u.username}: короткие отчеты — просить подробней`);
    if(u.net_count>u.da_count) recommendations.push(`${u.username}: качество отчетов низкое`);
  });

  res.json({heat, users, recommendations});
});

// 3. Последние отчеты
app.get('/api/reports', (req,res)=>{
  res.json(getReports());
});

// 4. Фидбек
app.post('/api/feedback', (req,res)=>{
  const {username, message, from_admin} = req.body;
  if(!username || !message) return res.json({success:false});
  addFeedback(username, from_admin||"Admin", message);
  // Отправляем ботом
  bot.sendMessage(`@${username}`, `Фидбек от ${from_admin||"Admin"}: ${message}`).catch(console.log);
  res.json({success:true});
});

// ------------------ Архивирование старых отчетов ------------------
archiveOldReports();

// ------------------ Запуск сервера ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
