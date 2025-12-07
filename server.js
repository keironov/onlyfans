import express from 'express';
import bodyParser from 'body-parser';
import TelegramBot from 'node-telegram-bot-api';
import { addUser, addReport, addFeedback, getUsers, getReports } from './database.js';

const app = express();
const PORT = process.env.PORT || 10000;

// ------------------ Настройка Telegram ------------------
const TOKEN = '8543977197:AAGZaAEgv-bXYKMLN3KmuFn15i4geOGBBDI';
// Используем webhook, так как на Render лучше не использовать polling
const bot = new TelegramBot(TOKEN);
const WEBHOOK_URL = `https://onlyfans-2liu.onrender.com/bot${TOKEN}`;

bot.setWebHook(WEBHOOK_URL);

// ------------------ Middleware ------------------
app.use(bodyParser.json());

// ------------------ Обработка входящих запросов от Telegram ------------------
app.post(`/bot${TOKEN}`, async (req, res) => {
  const update = req.body;

  if(update.message){
    const chatId = update.message.chat.id;
    const username = update.message.from.username || update.message.from.first_name || 'unknown';
    const message = update.message.text || '';
    const date = new Date(update.message.date * 1000).toISOString();

    // Добавляем пользователя, если нового
    addUser(username);

    // Добавляем отчет
    addReport(username, message, date);

    // Ответ бота
    await bot.sendMessage(chatId, `Принял твоё сообщение: "${message}"`);
  }

  res.sendStatus(200);
});

// ------------------ Тестовые маршруты ------------------
app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.get('/users', (req, res) => {
  res.json(getUsers());
});

app.get('/reports', (req, res) => {
  res.json(getReports());
});

// ------------------ Запуск сервера ------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook установлен: ${WEBHOOK_URL}`);
});
