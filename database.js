import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Создаем и открываем подключение к базе данных SQLite
export const openDatabase = async () => {
  const db = await open({
    filename: './database.db', // Файл базы данных
    driver: sqlite3.Database,
  });
  return db;
};

// Функция для выполнения запросов к базе данных
export const queryDatabase = async (sql, params = []) => {
  const db = await openDatabase();
  try {
    const result = await db.all(sql, params); // Выполнение SQL-запроса
    return result;
  } catch (error) {
    console.error('Ошибка при выполнении запроса:', error);
    throw error;
  } finally {
    await db.close(); // Закрываем подключение
  }
};

// Функция для создания таблиц в базе данных
export const createDatabase = async () => {
  const db = await openDatabase();
  try {
    // Создаем таблицу пользователей
    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создаем таблицу отчетов
    await db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT NOT NULL,
        reason TEXT NOT NULL,
        reportText TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создаем таблицу отзывов
    await db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manager TEXT NOT NULL,
        user TEXT NOT NULL,
        feedbackText TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('База данных успешно создана');
  } catch (error) {
    console.error('Ошибка при создании таблиц:', error);
    throw error;
  } finally {
    await db.close();
  }
};
