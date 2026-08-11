// One-time setup script: creates the first admin user in Supabase.
// Run locally (never on every server start, since Netlify Functions
// are stateless and this would race on every cold start):
//
//   cp .env.example .env   (fill in SUPABASE_URL / SUPABASE_SERVICE_KEY)
//   node scripts/create-admin.js
//
// Reads ADMIN_USERNAME / ADMIN_PASSWORD from .env, or prompts interactively.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');
const db = require('../db');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

(async () => {
  try {
    const existingCount = await db.countUsers();
    if (existingCount > 0) {
      console.log(`Вече има ${existingCount} потребител(и) в базата. Няма да презапиша нищо.`);
      console.log('Ако искаш нов админ акаунт, добави го директно през Supabase Table Editor (users), или разшири този скрипт.');
      process.exit(0);
    }

    let username = process.env.ADMIN_USERNAME;
    let password = process.env.ADMIN_PASSWORD;

    if (!username) username = await ask('Потребителско име за админ: ');
    if (!password) password = await ask('Парола за админ: ');

    if (!username || !password) {
      console.error('Трябват и потребителско име, и парола.');
      process.exit(1);
    }

    const hash = bcrypt.hashSync(password, 10);
    await db.createUser(username, hash);
    console.log(`Готово! Създаден е администраторски акаунт: ${username}`);
  } catch (err) {
    console.error('Грешка при създаване на админ акаунт:', err.message);
    process.exit(1);
  }
})();
