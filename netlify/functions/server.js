require('dotenv').config();
const serverless = require('serverless-http');
const buildApp = require('../../app');

const app = buildApp();
// Without this, binary responses (the QR code PNGs) get mangled into UTF-8
// text somewhere in the Lambda/Netlify response pipeline and come out
// corrupted — the browser then shows a broken image icon. Telling
// serverless-http which content types are binary makes it base64-encode
// the body and set isBase64Encoded, which Netlify needs to serve it intact.
const handler = serverless(app, {
  binary: [
    'image/png',
    'image/*',
    'application/octet-stream',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
});

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
