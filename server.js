import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { queryDatabase } from './database.js';

dotenv.config();

// Initialize the server app
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Telegram Bot
const botToken = process.env.BOT_TOKEN;
const bot = new TelegramBot(botToken);
const botAdminId = process.env.BOT_ADMIN_ID;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set the webhook
const webhookUrl = `https://${process.env.DOMAIN}/your-bot-path`;
bot.setWebHook(webhookUrl);

// Telegram bot webhook route
app.post('/your-bot-path', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200); // Respond with 200 OK to Telegram
});

// Routes for Dashboard API
app.get('/api/health', async (req, res) => {
  try {
    const result = await queryDatabase('SELECT COUNT(*) FROM users');
    res.json({ status: 'ok', users: result[0]['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Handle feedback form submission
app.post('/api/feedback', async (req, res) => {
  const { manager, user, feedbackText } = req.body;
  try {
    await queryDatabase(
      'INSERT INTO feedback (manager, user, feedbackText) VALUES (?, ?, ?)',
      [manager, user, feedbackText]
    );
    bot.sendMessage(user, feedbackText); // Send feedback to the user via Telegram
    res.json({ status: 'success', feedbackSent: true });
  } catch (error) {
    res.status(500).send('Failed to send feedback');
  }
});

// Handle quick report submission
app.post('/api/reports', async (req, res) => {
  const { user, reason, reportText } = req.body;
  try {
    await queryDatabase(
      'INSERT INTO reports (user, reason, reportText) VALUES (?, ?, ?)',
      [user, reason, reportText]
    );
    bot.sendMessage(botAdminId, `New report from @${user}: ${reason}`); // Notify admin
    res.json({ status: 'success', reportSent: true });
  } catch (error) {
    res.status(500).send('Failed to submit report');
  }
});

// Get global stats (summarized)
app.get('/api/stats/global', async (req, res) => {
  try {
    const result = await queryDatabase('SELECT COUNT(*) FROM reports');
    res.json({ totalReports: result[0]['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Fetch user data
app.get('/api/users', async (req, res) => {
  try {
    const users = await queryDatabase('SELECT * FROM users');
    res.json({ users });
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Telegram Bot Commands (for testing)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to the OnlyFans Dashboard!');
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
