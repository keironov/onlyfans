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

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.warn('WARNING: BOT_TOKEN or WEBHOOK_URL not set. Telegram integration disabled.');
}

db.init();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '200kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve frontend (static)
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
        const user = await db.ensureUserByTelegram(String(chatId), username, display);
        await bot.sendMessage(chatId, `Привет, ${display || username || 'User'}! Ты зарегистрирован.`);
      } catch (e) {
        console.error('/start handler error', e);
      }
    });

    // regular messages -> store as report
    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      try {
        const user = await db.ensureUserByTelegram(
          String(msg.from.id),
          msg.from.username || null,
          `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim()
        );
        const rep = await db.addReport({
          user_id: user.id,
          text: msg.text,
          created_at: Date.now()
        });
        await bot.sendMessage(
          msg.chat.id,
          `Отчёт получен. Тип: ${rep.task_type}. Длина: ${rep.length}. Suspicious: ${rep.suspicious ? 'yes' : 'no'}.`
        );
      } catch (e) {
        console.error('Error storing report', e);
      }
    });

  } catch (err) {
    console.error('Telegram init error', err);
    bot = null;
  }
}

// --- API routes ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: { webhook: !!WEBHOOK_URL, bot: !!BOT_TOKEN } });
});

// Users list
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.listUsers();
    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// User summary + reports
app.get('/api/user/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    const summary = await db.summaryForUser(user.id);
    const reports = await db.listReportsForUser(user.id, 500);
    // normalize summary keys for frontend
    const normSummary = {
      total: summary.total || 0,
      total_length: summary.total_length || 0,
      suspicious: summary.suspicious || 0
    };
    res.json({ ok: true, user, summary: normSummary, reports });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create report (from UI) — UPDATED: accepts `reason`
app.post('/api/reports', async (req, res) => {
  try {
    const { username, text, reason } = req.body;
    if (!username || !text || !reason) return res.status(400).json({ ok: false, error: 'username, reason and text required' });

    let user = await db.getUserByUsername(username);
    if (!user) user = await db.ensureUserByTelegram(`web-${Date.now()}`, username, username);

    const rep = await db.addReport({
      user_id: user.id,
      text,
      created_at: Date.now()
    });

    // send message to admin in the required format
    if (bot && BOT_ADMIN_ID) {
      const message = `🚨 Ручной Репорт\n\nЮзер: ${username}\nПричина: ${reason}\nТекст: ${text}`;
      try {
        await bot.sendMessage(BOT_ADMIN_ID, message);
      } catch (err) {
        console.error('Failed to notify admin via bot:', err?.response?.body || err);
      }
    }

    res.json({ ok: true, report: rep });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { manager_username, to_username, message } = req.body;
    if (!to_username || !message)
      return res.status(400).json({ ok: false, error: 'to_username and message required' });

    let manager = manager_username ? await db.getUserByUsername(manager_username) : null;
    if (!manager && manager_username)
      manager = await db.ensureUserByTelegram(`web-m-${Date.now()}`, manager_username, manager_username);

    let user = await db.getUserByUsername(to_username);
    if (!user)
      user = await db.ensureUserByTelegram(`web-u-${Date.now()}`, to_username, to_username);

    const f = await db.addFeedback({
      user_id: user.id,
      manager_id: manager ? manager.id : null,
      message,
      created_at: Date.now()
    });

    if (bot && user.telegram_id) {
      try {
        await bot.sendMessage(user.telegram_id, `Manager feedback: ${message}`);
      } catch (err) {
        console.error('Failed to send feedback to user via bot:', err?.response?.body || err);
      }
    }

    res.json({ ok: true, feedback: f });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Global stats
app.get('/api/stats/global', async (req, res) => {
  try {
    const s = await db.globalSummary();
    // try to include leaderboard key if you compute it elsewhere; keep compatibility
    res.json({ ok: true, summary: s });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin reports list
app.get('/api/reports', async (req, res) => {
  try {
    const reps = await db.listReports(1000);
    res.json({ ok: true, reports: reps });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Feedback list
app.get('/api/feedback', async (req, res) => {
  try {
    const all = await db.listFeedback();
    res.json({ ok: true, feedback: all });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
