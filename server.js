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

app.delete('/api/users/:id', async (req, res) => {
  try {
    await db.deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/users/:id/stats', async (req, res) => {
  try {
    const stats = await db.getUserDetailedStats(req.params.id);
    if (!stats) return res.json({ ok: false, error: 'User not found' });
    res.json({ ok: true, stats });
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
    const { number = 0, type = '' } = req.body;
    await db.updateReportStatus(req.params.id, 'approved', number, type);
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

app.get('/api/stats/detailed', async (req, res) => {
  try {
    const stats = await db.getDetailedStats();
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

app.get('/api/stats/growth/:type', async (req, res) => {
  try {
    const type = req.params.type;
    if (!['happn', 'instagram', 'lid'].includes(type)) {
      return res.json({ ok: false, error: 'Invalid type' });
    }
    const growth = await db.getConversionGrowth(type);
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

app.get('/api/stats/happn-accounts', async (req, res) => {
  try {
    const stats = await db.getHappnAccountStats();
    res.json({ ok: true, stats });
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

// --- WORK LOGS (BLOG) ---

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
      // Generate insights for specific user
      const user = stats.find(u => u.id === parseInt(user_id));
      if (user) {
        const totalConverted = (user.happn_total || 0) + (user.instagram_total || 0) + (user.lid_total || 0);
        const happnAccounts = user.happn_accounts_created || 0;
        const avgPerDay = happnAccounts > 0 ? (happnAccounts / 7).toFixed(1) : 0;

        // Check Happn account creation rate
        if (happnAccounts < 70) { // Less than 10 per day average
          insights.push({
            content: `${user.username}: Создано только ${happnAccounts} аккаунтов Happn за последние 7 дней (средн. ${avgPerDay}/день). Норма 10/день. Рекомендуется поговорить с сотрудником о причинах снижения продуктивности.`,
            category: 'warning',
            user_id: user.id
          });
        } else if (happnAccounts >= 70 && happnAccounts < 100) {
          insights.push({
            content: `${user.username}: Хорошая работа! Создано ${happnAccounts} аккаунтов Happn (средн. ${avgPerDay}/день). Близко к норме 10/день.`,
            category: 'success',
            user_id: user.id
          });
        } else if (happnAccounts >= 100) {
          insights.push({
            content: `${user.username}: Отличная работа! 🏆 Создано ${happnAccounts} аккаунтов Happn (средн. ${avgPerDay}/день). Превышает норму! Рекомендуется премия.`,
            category: 'success',
            user_id: user.id
          });
        }

        // Check conversion rate
        const conversionRate = happnAccounts > 0 ? ((totalConverted / happnAccounts) * 100).toFixed(1) : 0;
        if (conversionRate > 15) {
          insights.push({
            content: `${user.username}: Отличная конверсия ${conversionRate}%! Высокое качество работы с переводом на Instagram.`,
            category: 'success',
            user_id: user.id
          });
        } else if (conversionRate < 5 && happnAccounts > 20) {
          insights.push({
            content: `${user.username}: Низкая конверсия ${conversionRate}%. Создано ${happnAccounts} аккаунтов, но мало переводов (${totalConverted}). Нужна помощь с техникой перевода на Instagram.`,
            category: 'improvement',
            user_id: user.id
          });
        }

        // Check Instagram performance
        const instagramRatio = totalConverted > 0 ? ((user.instagram_total || 0) / totalConverted * 100).toFixed(0) : 0;
        if (instagramRatio > 60) {
          insights.push({
            content: `${user.username}: ${instagramRatio}% конверсий через Instagram. Отлично работает с ИИ-чатботом!`,
            category: 'performance',
            user_id: user.id
          });
        }
      }
    } else {
      // Generate global insights
      stats.forEach(user => {
        const totalConverted = (user.happn_total || 0) + (user.instagram_total || 0) + (user.lid_total || 0);
        const happnAccounts = user.happn_accounts_created || 0;
        const avgPerDay = happnAccounts > 0 ? (happnAccounts / 7).toFixed(1) : 0;

        // Check Happn account creation rate
        if (happnAccounts < 70 && happnAccounts > 0) {
          insights.push({
            content: `${user.username}: Создано только ${happnAccounts} аккаунтов Happn за неделю (средн. ${avgPerDay}/день). Норма 10/день. Требуется разговор.`,
            category: 'warning',
            user_id: user.id
          });
        } else if (happnAccounts >= 100) {
          insights.push({
            content: `${user.username}: Топ-перформер! 🏆 ${happnAccounts} аккаунтов Happn (средн. ${avgPerDay}/день). Рекомендуется премия!`,
            category: 'success',
            user_id: user.id
          });
        }

        // Check conversion rate
        const conversionRate = happnAccounts > 0 ? ((totalConverted / happnAccounts) * 100).toFixed(1) : 0;
        if (conversionRate < 5 && happnAccounts > 20) {
          insights.push({
            content: `${user.username}: Низкая конверсия ${conversionRate}%. Нужна помощь с техникой перевода на Instagram.`,
            category: 'improvement',
            user_id: user.id
          });
        }
      });

      // Global team insights
      const totalUsers = stats.length;
      const activeUsers = stats.filter(u => (u.happn_accounts_created || 0) > 0).length;
      if (activeUsers < totalUsers * 0.5) {
        insights.push({
          content: `Только ${activeUsers} из ${totalUsers} создают аккаунты Happn. Рекомендуется провести встречу с неактивными членами команды.`,
          category: 'team',
          user_id: null
        });
      }
    }

    // Save insights to database
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