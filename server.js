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

        // Get current date in YYYY-MM-DD format
        const now = new Date();
        const reportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // add pending report
        await db.addReport({
          user_id: user.id,
          text: msg.text,
          report_date: reportDate,
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

// === API ENDPOINTS ===

// --- USERS ---

app.get('/api/users', async (req, res) => {
  try {
    const users = await db.listUsers();
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/users/add', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ ok: false, error: 'Username required' });
    const user = await db.addUserByUsername(username);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    const user = await db.updateUserRole(req.params.id, role);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/users/:id/instagram', async (req, res) => {
  try {
    const { instagram } = req.body;
    const user = await db.updateUserInstagram(req.params.id, instagram);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await db.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- MANAGER NOTES ---

app.get('/api/notes/:userId', async (req, res) => {
  try {
    const notes = await db.listManagerNotes(req.params.userId);
    res.json({ ok: true, notes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/notes/add', async (req, res) => {
  try {
    const { user_id, note } = req.body;
    if (!user_id || !note) return res.json({ ok: false, error: 'Missing fields' });
    const newNote = await db.addManagerNote({ user_id, note });
    res.json({ ok: true, note: newNote });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/notes/:id', async (req, res) => {
  try {
    await db.deleteManagerNote(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- REPORTS ---

app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.listReports();
    res.json({ ok: true, reports });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/reports/:id/approve', async (req, res) => {
  try {
    const { happn_accounts = 0, leads_converted = 0, report_date = null } = req.body;
    await db.updateReportStatus(req.params.id, 'approved', happn_accounts, leads_converted, report_date);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/reports/:id/reject', async (req, res) => {
  try {
    await db.updateReportStatus(req.params.id, 'rejected');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- STATISTICS ---

app.get('/api/stats/global', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let stats;
    if (startDate && endDate) {
      stats = await db.getStatsByDateRange(startDate, endDate);
    } else {
      stats = await db.getDetailedStats();
    }
    
    const totals = {
      happn: stats.reduce((sum, s) => sum + (s.happn_total || 0), 0),
      leads: stats.reduce((sum, s) => sum + (s.leads_total || 0), 0),
      users: stats.length
    };
    
    res.json({ ok: true, data: totals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/detailed', async (req, res) => {
  try {
    const stats = await db.getDetailedStats();
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/by-date', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.json({ ok: false, error: 'startDate and endDate required' });
    }
    const stats = await db.getStatsByDateRange(startDate, endDate);
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/by-user/:userId', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await db.getStatsByUser(req.params.userId, startDate, endDate);
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/daily/:date', async (req, res) => {
  try {
    const stats = await db.getDailyStats(req.params.date);
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/approvals', async (req, res) => {
  try {
    const stats = await db.getApprovalStats();
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/growth/team', async (req, res) => {
  try {
    const growth = await db.getTeamGrowth();
    res.json({ ok: true, growth });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/growth/happn', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const growth = await db.getHappnGrowth(startDate, endDate);
    res.json({ ok: true, growth });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/growth/leads', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const growth = await db.getLeadsGrowth(startDate, endDate);
    res.json({ ok: true, growth });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/stats/absences', async (req, res) => {
  try {
    const ranking = await db.getAbsenceRanking();
    res.json({ ok: true, ranking });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- FEEDBACK ---

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

// --- WORK LOGS ---

app.get('/api/worklogs', async (req, res) => {
  try {
    const { date } = req.query;
    const logs = date ? await db.listWorkLogsByDate(date) : await db.listWorkLogs();
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/worklogs/add', async (req, res) => {
  try {
    const { user_id, date, status, reason } = req.body;
    if (!user_id || !date || !status) {
      return res.json({ ok: false, error: 'Missing required fields' });
    }
    const log = await db.addWorkLog({ user_id, date, status, reason: reason || '' });
    res.json({ ok: true, log });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- INSIGHTS ---

app.get('/api/insights', async (req, res) => {
  try {
    const insights = await db.listInsights();
    res.json({ ok: true, insights });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/insights/generate', async (req, res) => {
  try {
    const { user_id } = req.body;
    const stats = await db.getDetailedStats();
    const insights = [];

    if (user_id) {
      const user = stats.find(u => u.id === parseInt(user_id));
      if (user) {
        const happnAccounts = user.happn_total || 0;
        const leads = user.leads_total || 0;
        
        // Role-based insights
        if (user.role === 'Трафер') {
          if (leads < 10) {
            insights.push({
              content: `${user.username} (Трафер): Всего ${leads} лидов. Норма 10 лидов. Требуется улучшение.`,
              category: 'warning',
              user_id: user.id
            });
          } else {
            insights.push({
              content: `${user.username} (Трафер): Отлично! ${leads} лидов. Норма выполнена! 🎯`,
              category: 'success',
              user_id: user.id
            });
          }
          
          if (!user.instagram_username) {
            insights.push({
              content: `${user.username} (Трафер): ⚠️ Не указан Instagram аккаунт. Обязательно для роли Трафер!`,
              category: 'warning',
              user_id: user.id
            });
          }
        } else if (user.role === 'Новичок Трафер') {
          const dailyAvg = happnAccounts / 7;
          if (dailyAvg < 5) {
            insights.push({
              content: `${user.username} (Новичок): ${happnAccounts} аккаунтов Happn за неделю (средн. ${dailyAvg.toFixed(1)}/день). Норма 5/день.`,
              category: 'improvement',
              user_id: user.id
            });
          } else {
            insights.push({
              content: `${user.username} (Новичок): Хорошая работа! ${happnAccounts} аккаунтов (средн. ${dailyAvg.toFixed(1)}/день). 👍`,
              category: 'success',
              user_id: user.id
            });
          }
        }
      }
    } else {
      // Global insights
      stats.forEach(user => {
        const happnAccounts = user.happn_total || 0;
        const leads = user.leads_total || 0;
        
        if (user.role === 'Трафер' && leads < 10) {
          insights.push({
            content: `${user.username} (Трафер): ${leads} лидов. Не выполнена норма (10 лидов).`,
            category: 'warning',
            user_id: user.id
          });
        }
        
        if (user.role === 'Новичок Трафер' && happnAccounts < 35) {
          insights.push({
            content: `${user.username} (Новичок): ${happnAccounts} аккаунтов за неделю. Норма 5/день (35/неделю).`,
            category: 'improvement',
            user_id: user.id
          });
        }
      });
    }

    // Save insights
    for (const insight of insights) {
      await db.addInsight(insight);
    }

    res.json({ ok: true, insights });
  } catch (e) {
    console.error('insights generation error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/tg')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));