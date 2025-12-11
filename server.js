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

// --- Telegram bot via webhook ---
let bot = null;
if (BOT_TOKEN && WEBHOOK_URL) {
  try {
    bot = new TelegramBot(BOT_TOKEN, { webHook: true });
    const webhookPath = '/tg';
    const fullWebhookUrl = WEBHOOK_URL.replace(/\/$/, '') + webhookPath;

    (async () => {
      await bot.setWebHook(fullWebhookUrl);
      console.log('Telegram webhook set →', fullWebhookUrl);
    })().catch(err => {
      console.error('Failed to set webhook:', err?.response?.body || err);
    });

    app.post(webhookPath, (req, res) => {
      try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        console.error('Bot processUpdate error', err);
        res.sendStatus(500);
      }
    });

    // /start handler
    bot.onText(/\/start/, async (msg) => {
      try {
        const chatId = msg.chat.id;
        const username = msg.from.username || null;
        const display = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
        await db.ensureUserByTelegram(String(chatId), username, display);
        await bot.sendMessage(chatId, `Привет, ${display || username || 'User'}! Ты зарегистрирован.`);
      } catch (e) {
        console.error('/start handler error', e);
      }
    });

    // catch-all text messages (no command) -> save as pending report
    bot.on('message', async (msg) => {
      try {
        if (!msg.text || msg.text.startsWith('/')) return;
        const username = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
        const user = await db.ensureUserByTelegram(String(msg.chat.id), username, username);

        // add pending report
        await db.addReport({
          user_id: user.id,
          text: msg.text,
          created_at: Date.now()
        });

        // notify admin (if configured)
        if (BOT_ADMIN_ID) {
          await bot.sendMessage(BOT_ADMIN_ID, `📝 Новый отчет от ${username}: ${msg.text}`);
        }

        // confirm
        await bot.sendMessage(msg.chat.id, 'Ваш отчет получен и ожидает одобрения.');
      } catch (e) {
        console.error('message handler error', e);
      }
    });

  } catch (err) {
    console.error('Telegram init error', err);
    bot = null;
  }
} else {
  console.warn('BOT_TOKEN or WEBHOOK_URL not set — telegram disabled.');
}

// === API ===

// Получение всех пользователей
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.listUsers();
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Добавление нового пользователя
app.post('/api/users/add', async (req, res) => {
  try {
    const { username, display_name } = req.body;
    if (!username) return res.status(400).json({ ok: false, error: 'username missing' });
    const user = await db.addUser({ username, display_name });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Удаление пользователя
app.post('/api/users/:id/delete', async (req, res) => {
  try {
    const id = req.params.id;
    await db.deleteUser(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Назначение роли пользователю
app.post('/api/users/:id/role', async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;
    await db.setUserRole(id, role);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Получение всех отчетов
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.listReports();
    res.json({ ok: true, reports });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Одобрение отчета с числом и типом
app.post('/api/reports/:id/approve', async (req, res) => {
  try {
    const { number = 0, type = '' } = req.body;
    await db.updateReportStatus(req.params.id, 'approved', number, type);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Отклонение отчета
app.post('/api/reports/:id/reject', async (req, res) => {
  try {
    await db.updateReportStatus(req.params.id, 'rejected');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Глобальная статистика
app.get('/api/stats/global', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const reports = await db.listReports();

    let fromTime = 0;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (period) {
      case 'today': fromTime = start.getTime(); break;
      case 'yesterday': fromTime = start.getTime() - 86400000; break;
      case 'week': fromTime = start.getTime() - 7 * 86400000; break;
      case 'month': fromTime = start.getTime() - 30 * 86400000; break;
      default: fromTime = 0;
    }

    const filtered = reports.filter(r => r.status === 'approved' && (r.created_at || 0) >= fromTime);

    const data = { happn: 0, instagram: 0, lid: 0 };
    filtered.forEach(r => {
      if (r.type && r.number) {
        const t = r.type;
        data[t] = (data[t] || 0) + (parseInt(r.number) || 0);
      }
    });

    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// SEND FEEDBACK
app.post('/api/feedback/send', async (req, res) => {
  try {
    const { telegram_id, text } = req.body;
    if (!telegram_id) return res.json({ ok: false, error: 'telegram_id missing' });
    if (!text) return res.json({ ok: false, error: 'text missing' });
    if (!bot) return res.json({ ok: false, error: 'Bot not active' });

    const message = `📨 *Фидбек от менеджера*\n\n${text}`;
    await bot.sendMessage(String(telegram_id), message, { parse_mode: 'Markdown' });

    res.json({ ok: true });
  } catch (e) {
    console.error('feedback send error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// User summary per username
app.get('/api/users/:username/summary', async (req, res) => {
  try {
    const user = await db.getUserByUsername(req.params.username);
    if (!user) return res.json({ ok: false, error: 'User not found' });
    const summary = await db.summaryForUser(user.id);
    const reports = await db.listReportsForUser(user.id);
    res.json({ ok: true, user, summary, reports });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
