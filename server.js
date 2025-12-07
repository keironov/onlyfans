// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const TelegramBot = require('node-telegram-bot-api');

require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_ADMIN_ID = process.env.BOT_ADMIN_ID || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://your-app.onrender.com
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !WEBHOOK_URL) {
  console.warn('WARNING: BOT_TOKEN or WEBHOOK_URL not set. Telegram integration will be disabled until env set.');
}

db.init();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '200kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve frontend
app.use('/', express.static(path.join(__dirname, 'public')));

// --- Telegram bot (webhook) ---
let bot = null;
if (BOT_TOKEN && WEBHOOK_URL) {
  try {
    bot = new TelegramBot(BOT_TOKEN);
    const webhookPath = '/tg';
    const fullWebhookUrl = WEBHOOK_URL.replace(/\/$/, '') + webhookPath;
    (async () => {
      await bot.setWebHook(fullWebhookUrl);
      console.log('Telegram webhook set to:', fullWebhookUrl);
    })().catch(err => {
      console.error('Failed to set webhook:', err && err.response ? err.response.body : err);
    });

    // handle updates: express route
    app.post(webhookPath, (req, res) => {
      try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        console.error('Bot processUpdate error', err);
        res.sendStatus(500);
      }
    });

    // Bot message handling: register simple handlers
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username || null;
      const display = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
      const user = await db.ensureUserByTelegram(String(chatId), username, display);
      bot.sendMessage(chatId, `Привет, ${display || username || 'User'}! Твой профиль зарегистрирован.`);
    });

    bot.on('message', async (msg) => {
      // only handle text messages that are not commands
      if (!msg.text) return;
      if (msg.text.startsWith('/')) return;
      // store as quick report
      try {
        const user = await db.ensureUserByTelegram(String(msg.from.id), msg.from.username || null, `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim());
        const rep = await db.addReport({ user_id: user.id, text: msg.text, created_at: Date.now() });
        // reply with short analytics / acknowledgement
        let reply = `Отчёт получен. Тип: ${rep.task_type}. Длина: ${rep.length}. Suspicious: ${rep.suspicious ? 'yes' : 'no'}.`;
        bot.sendMessage(msg.chat.id, reply);
      } catch (e) {
        console.error('Failed to store incoming report', e);
      }
    });

  } catch (err) {
    console.error('Telegram init error', err);
    bot = null;
  }
}

// --- API routes ---

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, env: { webhook: !!WEBHOOK_URL, bot: !!BOT_TOKEN } }));

// Users list
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.listUsers();
    res.json({ ok: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get user summary & reports
app.get('/api/user/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    const summary = await db.summaryForUser(user.id);
    const reports = await db.listReportsForUser(user.id, 500);
    res.json({ ok: true, user, summary, reports });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create report (from web UI)
app.post('/api/reports', async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text) return res.status(400).json({ ok: false, error: 'username and text required' });
    let user = await db.getUserByUsername(username);
    if (!user) {
      // create a user placeholder
      user = await db.ensureUserByTelegram(`web-${Date.now()}`, username, username);
    }
    const rep = await db.addReport({ user_id: user.id, text, created_at: Date.now() });
    // optional: notify via telegram if BOT_ADMIN_ID provided
    if (bot && BOT_ADMIN_ID) {
      bot.sendMessage(BOT_ADMIN_ID, `New report from ${username}: ${text.slice(0,200)}`);
    }
    res.json({ ok: true, report: rep });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Feedback (manager sends feedback to user from web UI)
app.post('/api/feedback', async (req, res) => {
  try {
    const { manager_username, to_username, message } = req.body;
    if (!to_username || !message) return res.status(400).json({ ok:false, error:'to_username and message required' });

    // find/create manager and user
    let manager = manager_username ? await db.getUserByUsername(manager_username) : null;
    if (!manager && manager_username) manager = await db.ensureUserByTelegram(`web-m-${Date.now()}`, manager_username, manager_username);

    let user = await db.getUserByUsername(to_username);
    if (!user) user = await db.ensureUserByTelegram(`web-u-${Date.now()}`, to_username, to_username);

    const f = await db.addFeedback({ user_id: user.id, manager_id: manager ? manager.id : null, message, created_at: Date.now() });

    // send to user's telegram if available
    if (bot && user.telegram_id) {
      bot.sendMessage(user.telegram_id, `Manager feedback: ${message}`);
    }

    res.json({ ok: true, feedback: f });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// Global stats
app.get('/api/stats/global', async (req, res) => {
  try {
    const s = await db.globalSummary();
    res.json({ ok: true, summary: s });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// List reports (admin)
app.get('/api/reports', async (req, res) => {
  try {
    const reps = await db.listReports(1000);
    res.json({ ok: true, reports: reps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// Feedback listing
app.get('/api/feedback', async (req, res) => {
  try {
    const all = await db.listFeedback();
    res.json({ ok: true, feedback: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// Fallback: serve index.html for SPA routes
app.get('*', (req, res, next) => {
  // allow api routes pass
  if (req.path.startsWith('/api') || req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
