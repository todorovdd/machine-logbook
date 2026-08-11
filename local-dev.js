// Plain Node/Express entry point for local testing WITHOUT netlify-cli,
// e.g. `node local-dev.js`. Static files (public/) are served the same
// way Netlify would serve them.
require('dotenv').config();
const path = require('path');
const express = require('express');
const buildApp = require('./app');

const app = buildApp();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`Machine Logbook (local, non-Netlify) работи на http://localhost:${PORT}`);
});
