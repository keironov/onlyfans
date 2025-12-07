import express from 'express';
import bodyParser from 'body-parser';
import TelegramBot from 'node-telegram-bot-api';
import { 
  addUser, 
  addReport, 
  addFeedback, 
  archiveOldReports, 
  computeKPI, 
  getUsers, 
  getReports, 
  getActivityHeat 
} from './database.js';

// ------------------ Настройки ------------------
const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const TELEGRAM_TOKEN = process.env.BOT_TOKEN || "8543977197:AAGZaAEgv-bXYKMLN3KmuFn15i4geOGBBDI";
const bot = new TelegramBot(TELEGRAM_TOKEN, { webHook: true });
const WEBHOOK_URL = `https://onlyfans-2liu.onrender.com/bot${TELEGRAM_TOKEN}`;

bot.setWebHook(WEBHOOK_URL);
console.log("Webhook установлен:", WEBHOOK_URL);

// ------------------ Авто-замечания ------------------
function autoNotice(chatId, message){
  const notice = `⚠️ Авто-замечание: отчет подозрительный или слишком короткий. Пожалуйста, напиши подробнее.`;
  bot.sendMessage(chatId, notice).catch(console.log);
  addFeedback(chatId, "system", notice);
}

// ------------------ Telegram WebHook ------------------
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ------------------ Логика бота ------------------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || "unknown";
  const text = msg.text || "";
  const date = new Date().toISOString();

  addUser(username);

  // Вставка отчета с защитой типов для SQLite
  try {
    addReport(
      String(username),
      String(text),
      String(date),
      undefined, // task_type вычислится внутри addReport
      false      // suspicious по умолчанию
    );
  } catch(err) {
    console.log("Ошибка при добавлении отчета:", err.message);
  }

  bot.sendMessage(chatId, `Отчет принят!`).catch(console.log);
});

// ------------------ API для фронтенда ------------------
app.get('/api/analytics', (req,res)=>{
  const users = getUsers();
  const taskCounts = {accounts:0, chat:0, to_ig:0};
  const recommendations = [];

  users.forEach(u=>{
    const types = u.types_json ? JSON.parse(u.types_json) : {accounts:0, chat:0, to_ig:0};
    Object.keys(types).forEach(k=> taskCounts[k] += types[k]);

    if((types.accounts||0) > (types.to_ig||0)*4)
      recommendations.push(`${u.username}: много аккаунтов, мало переводов`);

    if(u.avg_length < 30)
      recommendations.push(`${u.username}: короткие отчеты — просить подробнее`);

    if(u.net_count > u.da_count)
      recommendations.push(`${u.username}: качество отчетов низкое`);
  });

  res.json({users, taskCounts, recommendations});
});

app.get('/api/extended_analytics', (req,res)=>{
  const heat = getActivityHeat();
  const users = getUsers().map(u=>{
    const types = u.types_json ? JSON.parse(u.types_json) : {accounts:0, chat:0, to_ig:0};
    const kpi = computeKPI({
      total_reports: u.total_reports,
      da_count: u.da_count,
      net_count: u.net_count,
      repeats: u.repeats,
      avg_length: u.avg_length,
      types
    });
    return {...u, types, kpi};
  });

  const recommendations = [];
  users.forEach(u=>{
    if((u.types.accounts||0) > (u.types.to_ig||0)*4)
      recommendations.push(`${u.username}: много аккаунтов, мало переводов`);
    if(u.avg_length<30)
      recommendations.push(`${u.username}: короткие отчеты — просить подробнее`);
    if(u.net_count>u.da_count)
      recommendations.push(`${u.username}: качество отчетов низкое`);
  });

  res.json({heat, users, recommendations});
});

app.get('/api/reports', (req,res)=>{
  res.json(getReports());
});

app.post('/api/feedback', (req,res)=>{
  const {chatId, message, from_admin} = req.body;
  if(!chatId || !message) return res.json({success:false});

  addFeedback(chatId, from_admin||"Admin", message);

  bot.sendMessage(chatId, `📩 Фидбек от админа:\n${message}`).catch(console.log);

  res.json({success:true});
});

// ------------------ Архивирование ------------------
archiveOldReports();

// ------------------ Запуск сервера ------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
