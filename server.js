import express from 'express';
import bodyParser from 'body-parser';
import { initDB } from './database.js';
import TelegramBot from 'node-telegram-bot-api';

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_WEBHOOK_URL = process.env.WEBHOOK_URL; // Например: https://yourdomain.com/bot

const db = await initDB();

// --- TelegramBot webhook ---
let bot;
if (TELEGRAM_TOKEN && TELEGRAM_WEBHOOK_URL) {
  bot = new TelegramBot(TELEGRAM_TOKEN);
  bot.setWebHook(`${TELEGRAM_WEBHOOK_URL}/bot`);

  app.post('/bot', async (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  bot.onText(/\/feedback/, async (msg) => {
    const username = msg.from.username;
    const feedbacks = await db.all(`SELECT message,date FROM feedback WHERE username = ?`, [username]);
    let text = feedbacks.map(f => `${f.date}: ${f.message}`).join('\n') || 'Нет новых сообщений';
    bot.sendMessage(msg.chat.id, text);
  });
}

// --- Add report ---
app.post('/report', async (req, res) => {
  const { username, text } = req.body;
  const date = new Date().toISOString();

  // Авто-анализ задач
  let task_type = 'other';
  if (/аккаунты|happn/i.test(text)) task_type = 'accounts';
  else if (/чатинг|писал|отвечал/i.test(text)) task_type = 'chat';
  else if (/перевел|отправил|инста/i.test(text)) task_type = 'transfer';

  // Авто-замечание: короткий или шаблонный текст
  const suspicious = text.length < 15 || /(делал аккаунты|проверял|писал людям)/i.test(text) ? 1 : 0;

  await db.run(`INSERT INTO reports (username,text,date,task_type,suspicious) VALUES (?,?,?,?,?)`, [username,text,date,task_type,suspicious]);

  res.json({ status: 'ok' });
});

// --- Add feedback ---
app.post('/feedback', async (req,res) => {
  const { username, message } = req.body;
  const date = new Date().toISOString();
  await db.run(`INSERT INTO feedback (username,message,date) VALUES (?,?,?)`, [username,message,date]);
  res.json({ status: 'ok' });
});

// --- Get user stats ---
app.get('/user/:username', async (req,res) => {
  const username = req.params.username;
  const reports = await db.all(`SELECT * FROM reports WHERE username = ?`, [username]);
  
  // KPI расчёт
  const da = reports.reduce((a,r)=>a+r.da,0)/reports.length || 0;
  const net = reports.reduce((a,r)=>a+r.net,0)/reports.length || 0;
  const activity = reports.length;

  res.json({ username, reports, da, net, activity });
});

// --- Get team stats ---
app.get('/team', async (req,res) => {
  const users = await db.all(`SELECT username, COUNT(*) as reports, AVG(da) as da, AVG(net) as net FROM reports GROUP BY username`);
  res.json(users);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
