import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

dotenv.config();

// Create the server app
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const botAdminId = process.env.BOT_ADMIN_ID;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection and initialization
const dbPromise = open({
  filename: './database.db', // Ensure this path is correct for your deployment
  driver: sqlite3.Database,
});

// Ensure that the necessary tables exist in the database
const initializeDatabase = async () => {
  const db = await dbPromise;
  
  // Create the 'users' table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create the 'feedback' table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager TEXT NOT NULL,
      user TEXT NOT NULL,
      feedbackText TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create the 'reports' table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      reason TEXT NOT NULL,
      reportText TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

// Initialize the database
initializeDatabase().catch(err => {
  console.error("Error initializing the database:", err);
  process.exit(1);
});

// Routes for Dashboard API
app.get('/api/health', async (req, res) => {
  try {
    const db = await dbPromise;
    const result = await db.get('SELECT COUNT(*) FROM users');
    res.json({ status: 'ok', users: result['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Handle feedback form submission
app.post('/api/feedback', async (req, res) => {
  const { manager, user, feedbackText } = req.body;
  try {
    const db = await dbPromise;
    await db.run(
      'INSERT INTO feedback (manager, user, feedbackText) VALUES (?, ?, ?)',
      [manager, user, feedbackText]
    );
    bot.sendMessage(user, feedbackText); // Send feedback to the user via Telegram
    res.json({ status: 'success', feedbackSent: true });
  } catch (error) {
    res.status(500).send('Failed to submit feedback');
  }
});

// Handle quick report submission
app.post('/api/reports', async (req, res) => {
  const { user, reason, reportText } = req.body;
  try {
    const db = await dbPromise;
    await db.run(
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
    const db = await dbPromise;
    const result = await db.get('SELECT COUNT(*) FROM reports');
    res.json({ totalReports: result['COUNT(*)'] });
  } catch (error) {
    res.status(500).send('Failed to fetch stats');
  }
});

// Fetch user data
app.get('/api/users', async (req, res) => {
  try {
    const db = await dbPromise;
    const users = await db.all('SELECT * FROM users');
    res.json({ users });
  } catch (error) {
    res.status(500).send('Failed to fetch users');
  }
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
