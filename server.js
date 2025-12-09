import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
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

// === Telegram bot webhook ===
let bot = null;
if (BOT_TOKEN && WEBHOOK_URL) {
  try {
    bot = new TelegramBot(BOT_TOKEN, { webHook: true });
    const webhookPath = '/tg';
    const fullWebhookUrl = WEBHOOK_URL.replace(/\/$/, '') + webhookPath;

    (async () => {
      await bot.setWebHook(fullWebhookUrl);
      console.log('Telegram webhook set →', fullWebhookUrl);
    })();

    app.post(webhookPath, (req, res) => {
      try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        console.error('Bot processUpdate error', err);
        res.sendStatus(500);
      }
    });

    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username || null;
      const display = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      await db.ensureUserByTelegram(String(chatId), username, display);
      await bot.sendMessage(chatId, `Привет, ${display || username || 'User'}!`);
    });

    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;

      const username = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      const user = await db.ensureUserByTelegram(String(msg.chat.id), username, username);

      // Add pending report
      await db.addReport({
        user_id: user.id,
        text: msg.text,
        created_at: Date.now()
      });

      // Notify admin
      if (BOT_ADMIN_ID) {
        await bot.sendMessage(BOT_ADMIN_ID, `📝 Новый отчет от ${username}: ${msg.text}`);
      }

      // Confirm receipt
      await bot.sendMessage(msg.chat.id, 'Ваш отчет получен и ожидает одобрения.');
    });
  } catch (err) {
    console.error('Telegram init error', err);
    bot = null;
  }
}

// === API ===

// Получение всех пользователей с ролями
app.get('/api/users', async (req,res)=> {
  try { 
    const users = await db.listUsers();
    res.json({ ok:true, users });
  } catch(e){ res.json({ ok:false, error:e.message }); }
});

// Получение глобальной статистики по категориям и периодам
app.get('/api/stats/global', async (req,res)=>{
  try {
    const period = req.query.period || 'today';
    const reports = await db.listReports();

    const now = Date.now();
    let fromTime = 0;
    switch(period){
      case 'today':
        const t = new Date(); t.setHours(0,0,0,0); fromTime = t.getTime(); break;
      case 'yesterday':
        const y = new Date(); y.setHours(0,0,0,0); fromTime = y.getTime()-86400000; break;
      case 'week':
        const w = new Date(); w.setHours(0,0,0,0); fromTime = w.getTime()-7*86400000; break;
      case 'month':
        const m = new Date(); m.setHours(0,0,0,0); fromTime = m.getTime()-30*86400000; break;
    }

    const filtered = reports.filter(r=>r.status==='approved' && r.created_at >= fromTime);
    const data = { happn:0, instagram:0, lid:0 };
    filtered.forEach(r=>{
      if(r.number && r.type) data[r.type] += parseInt(r.number)||0;
    });

    res.json({ ok:true, data });
  } catch(e){ res.json({ ok:false, error:e.message }); }
});

// Получение всех отчетов
app.get('/api/reports', async (req,res)=> {
  try { const reports = await db.listReports(); res.json({ ok:true, reports }); } 
  catch(e){ res.json({ ok:false, error:e.message }); }
});

// Одобрение отчета с числом и типом
app.post('/api/reports/:id/approve', async (req,res)=>{
  try {
    const { number, type } = req.body;
    await db.updateReportStatus(req.params.id,'approved', number, type);
    res.json({ ok:true });
  } catch(e){ res.json({ ok:false, error:e.message }); }
});

// Отклонение отчета
app.post('/api/reports/:id/reject', async (req,res)=>{
  try { await db.updateReportStatus(req.params.id,'rejected'); res.json({ ok:true }); } 
  catch(e){ res.json({ ok:false, error:e.message }); }
});

// User summary по username
app.get('/api/users/:username/summary', async (req,res)=>{
  try {
    const user = await db.getUserByUsername(req.params.username);
    if(!user) return res.json({ ok:false, error:'User not found' });
    const summary = await db.summaryForUser(user.id);
    // Считаем категории
    const reports = await db.listReportsForUser(user.id);
    const categories = { happn:0, instagram:0, lid:0 };
    reports.forEach(r=>{
      if(r.number && r.type) categories[r.type] += parseInt(r.number)||0;
    });
    res.json({ ok:true, summary, categories, reports });
  } catch(e){ res.json({ ok:false, error:e.message }); }
});

// SPA fallback
app.get('*', (req,res,next)=>{
  if(req.path.startsWith('/api')||req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
