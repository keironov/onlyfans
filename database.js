import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Open a database connection
async function openDatabase() {
  return open({
    filename: './data.db',
    driver: sqlite3.Database
  });
}

// Query database
export async function queryDatabase(query, params = []) {
  const db = await openDatabase();
  const result = await db.all(query, params);
  db.close();
  return result;
}

// Initialize database schema
export async function createDatabase() {
  const db = await openDatabase();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, telegram_id INTEGER);
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, user TEXT, reason TEXT, reportText TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, manager TEXT, user TEXT, feedbackText TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  db.close();
}
