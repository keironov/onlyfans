import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import * as db from './database.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_ADMIN_ID = process.env.BOT_ADMIN_ID || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

db.init();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '200kb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/', express.static(path.join(__dirname, 'public')));

const LOG_FILE = path.join(process.cwd(), 'text_log.txt');

let bot = null;
if (BOT_TOKEN && WEBHOOK_URL) {
  try {
    bot = new TelegramBot(BOT_TOKEN, { webHook: true });
    const webhookPath = '/tg';
    const fullWebhookUrl = WEBHOOK_URL.replace(/\/$/, '') + webhookPath;
    (async () => {
      await bot.setWebHook(fullWebhookUrl);
      console.log('Telegram webhook set →', fullWebhookUrl);
    })().catch(console.error);

    app.post(webhookPath, (req, res) => {
      try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) { console.error(err); res.sendStatus(500); }
    });

    // Стартовое сообщение
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username || null;
      const display = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      await db.ensureUserByTelegram(String(chatId), username, display);
      await bot.sendMessage(chatId, `Привет, ${display || username || 'User'}! Ты зарегистрирован.`);
    });

    // Логирование текста + запись в базу
    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;

      const username = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      const chatId = msg.chat.id;

      // Лог в text_log.txt
      const logEntry = `${username}: ${msg.text}\n`;
      try { fs.appendFileSync(LOG_FILE, logEntry, 'utf8'); } catch(e){ console.error(e); }

      // Сохранение как репорт
      try {
        const user = await db.ensureUserByTelegram(String(chatId), msg.from.username, username);
        await db.addReport({ user_id: user.id, text: msg.text, created_at: Date.now() });

        if (BOT_ADMIN_ID) {
          await bot.sendMessage(BOT_ADMIN_ID, `🚨 Новый репорт от ${username}:\n${msg.text}`);
        }

        await bot.sendMessage(chatId, 'Ваш репорт успешно добавлен в статистику!');
      } catch(e){ 
        console.error('Ошибка добавления репорта:', e);
        await bot.sendMessage(chatId, 'Ошибка при добавлении репорта.'); 
      }
    });

    // Команда /report для ручного добавления
    bot.onText(/\/report (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const text = match[1];
      const username = msg.from.username ? `@${msg.from.username}` : chatId;
      try {
        const user = await db.ensureUserByTelegram(String(chatId), msg.from.username, username);
        await db.addReport({ user_id: user.id, text, created_at: Date.now() });

        if (BOT_ADMIN_ID) await bot.sendMessage(BOT_ADMIN_ID, `🚨 Репорт от ${username}: ${text}`);
        await bot.sendMessage(chatId, 'Репорт добавлен в статистику!');
      } catch(e){
        console.error(e);
        await bot.sendMessage(chatId, 'Ошибка при добавлении репорта.');
      }
    });

  } catch(err){ console.error('Telegram init error', err); bot = null; }
}

// === API ===
app.get('/api/health', (req,res)=>res.json({ ok:true }));

app.get('/api/users', async (req,res)=>{
  try { const users = await db.listUsers(); res.json({ ok:true, users }); }
  catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/reports', async (req,res)=>{
  try { const reports = await db.listReports(1000); res.json({ ok:true, reports }); }
  catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/reports', async (req,res)=>{
  try{
    const { username, text, reason } = req.body;
    if(!username||!text||!reason) return res.status(400).json({ ok:false, error:'username, text, reason required' });
    let user = await db.getUserByUsername(username);
    if(!user) user = await db.ensureUserByTelegram(`web-${Date.now()}`, username, username);
    const rep = await db.addReport({ user_id:user.id, text:`[${reason}] ${text}`, created_at:Date.now() });
    if(bot && BOT_ADMIN_ID) await bot.sendMessage(BOT_ADMIN_ID, `🚨 Ручной репорт от ${username}: ${text}`);
    res.json({ ok:true, report:rep });
  }catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

// Глобальная статистика
app.get('/api/stats/global', async (req,res)=>{
  try{ const s = await db.globalSummary(); res.json({ ok:true, summary:s }); }
  catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

// SPA fallback
app.get('*', (req,res,next)=>{
  if(req.path.startsWith('/api')||req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
