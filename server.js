import express from 'express';
import bodyParser from 'body-parser';
import { addReport, addUser, addFeedback, getUsers, getReports, getUserMetrics, getActivityHeat, computeKPI } from './database.js';

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 10000;

// ------------------ Telegram Webhook ------------------
app.post('/bot8543977197:AAGZaAEgv-bXYKMLN3KmuFn15i4geOGBBDI', (req,res)=>{
  const update = req.body;
  if(update.message){
    const username = update.message.from.username || update.message.from.first_name;
    const text = update.message.text;
    addUser(username);
    addReport(username, text, new Date().toISOString());
  }
  res.json({ok:true});
});

// ------------------ API для сайта ------------------
app.get('/api/users', (req,res)=>res.json(getUsers()));
app.get('/api/reports', (req,res)=>res.json(getReports()));

app.get('/api/user/:username', (req,res)=>{
  const username = req.params.username;
  const metrics = getUserMetrics(username);
  const activity = getActivityHeat().filter(a=>a.username===username);
  const reports = getReports().filter(r=>r.username===username);
  const types = metrics.types_json ? JSON.parse(metrics.types_json) : {accounts:0,chat:0,to_ig:0};
  const kpi = computeKPI({...metrics, types});
  res.json({username, metrics, activity, reports, kpi});
});

// Добавление фидбека вручную
app.post('/api/feedback', (req,res)=>{
  const {username, from_admin, message} = req.body;
  addFeedback(username, from_admin, message);
  res.json({ok:true});
});

// Общая аналитика
app.get('/api/analytics', (req,res)=>{
  const users = getUsers();
  const analytics = users.map(u=>{
    const types = u.types_json ? JSON.parse(u.types_json) : {accounts:0, chat:0, to_ig:0};
    const kpi = computeKPI({...u, types});
    return {...u, types, kpi};
  });
  res.json(analytics);
});

app.get('/', (req,res)=>res.send('Server is running!'));
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
