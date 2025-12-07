import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { queryDatabase, createDatabase } from './database.js';

dotenv.config();

// Создание экземпляра приложения Express
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Telegram бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const botAdminId = process.env.BOT_ADMIN_ID;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Очистка старого вебхука (если есть)
bot.deleteWebHook().then(() => {
  const webhookUrl = 'https://onlyfans-2liu.onrender.com/your-webhook-path'; // Укажите ваш путь webhook
  bot.setWebHook(webhookUrl);
}).catch(error => {
  console.error('Error deleting old webhook:', error);
});

// Роут для проверки состояния
app.get('/api/health', async (req, res) => {
  try {
    const result = await queryDatabase('SELECT COUNT(*) FROM users');
    res.json({ status: 'ok', users: result[0]['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Роут для обработки формы отзыва
app.post('/api/feedback', async (req, res) => {
  const { manager, user, feedbackText } = req.body;
  try {
    const result = await queryDatabase(
      'INSERT INTO feedback (manager, user, feedbackText) VALUES (?, ?, ?)',
      [manager, user, feedbackText]
    );
    bot.sendMessage(user, feedbackText); // Отправка отзыва пользователю через Telegram
    res.json({ status: 'success', feedbackSent: true });
  } catch (error) {
    res.status(500).send('Error sending feedback');
  }
});

// Роут для отправки отчетов
app.post('/api/reports', async (req, res) => {
  const { user, reason, reportText } = req.body;
  try {
    const result = await queryDatabase(
      'INSERT INTO reports (user, reason, reportText) VALUES (?, ?, ?)',
      [user, reason, reportText]
    );
    bot.sendMessage(botAdminId, `New report from @${user}: ${reason}`); // Уведомление администратора
    res.json({ status: 'success', reportSent: true });
  } catch (error) {
    res.status(500).send('Error sending report');
  }
});

// Роут для получения статистики
app.get('/api/stats/global', async (req, res) => {
  try {
    const result = await queryDatabase('SELECT COUNT(*) FROM reports');
    res.json({ totalReports: result[0]['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Error fetching stats');
  }
});

// Роут для получения данных о пользователях
app.get('/api/users', async (req, res) => {
  try {
    const users = await queryDatabase('SELECT * FROM users');
    res.json({ users });
  } catch (error) {
    res.status(500).send('Error fetching users');
  }
});

// Обработчик для вебхука Telegram (для получения обновлений от Telegram API)
app.post('/your-webhook-path', async (req, res) => {
  try {
    const { message } = req.body;

    // Простой пример: Если пользователь пишет что-то, мы отправляем ответ
    if (message && message.text) {
      bot.sendMessage(message.chat.id, `You said: ${message.text}`);
    }

    res.status(200).send();
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).send();
  }
});

// Старт сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
