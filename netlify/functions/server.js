require('dotenv').config();
const serverless = require('serverless-http');
const buildApp = require('../../app');

const app = buildApp();
const handler = serverless(app);

// Netlify's redirect forwards the full original path as
// "/.netlify/functions/server/<real-path>" (see netlify.toml, which uses
// the :splat placeholder). Express needs the real path without that
// prefix, so we strip it before handing the event to serverless-http.
const PREFIX = '/.netlify/functions/server';

module.exports.handler = async (event, context) => {
  if (event.path && event.path.startsWith(PREFIX)) {
    event.path = event.path.slice(PREFIX.length) || '/';
  }
  return handler(event, context);
};
