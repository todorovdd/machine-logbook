const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const ejs = require('ejs');
const QRCode = require('qrcode');
const db = require('./db');
const { issueSession, clearSession, currentUser, requireAuth } = require('./auth');

// Templates are bundled into a plain JS object at build/install time (see
// scripts/build-views.js, runs automatically via the "postinstall" npm
// script) instead of being read from views/*.ejs on disk. Netlify Functions
// only reliably package files that are statically `require`d, so this
// avoids any risk of the views folder not being found at runtime.
const templates = require('./views-bundled.js');

function buildApp() {
  const app = express();
  const BASE_URL = process.env.BASE_URL || 'http://localhost:8888';

  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  function render(res, name, data, statusCode) {
    const tpl = templates[name];
    if (!tpl) throw new Error(`Липсва шаблон "${name}" в views-bundled.js`);
    const html = ejs.render(tpl, data, { filename: name });
    if (statusCode) res.status(statusCode);
    res.type('html').send(html);
  }

  // ---------- AUTH ----------
  app.get('/login', (req, res) => {
    if (currentUser(req)) return res.redirect('/');
    render(res, 'login', { error: null });
  });

  app.post('/login', async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const user = await db.getUserByUsername(username || '');
      if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
        return render(res, 'login', { error: 'Грешно потребителско име или парола.' });
      }
      issueSession(res, user);
      res.redirect('/');
    } catch (err) { next(err); }
  });

  app.get('/logout', (req, res) => {
    clearSession(res);
    res.redirect('/login');
  });

  // ---------- DASHBOARD: FACTORIES ----------
  app.get('/', requireAuth, async (req, res, next) => {
    try {
      const factories = await db.listFactoriesWithMachineCount();
      render(res, 'dashboard', { factories, username: req.user.username });
    } catch (err) { next(err); }
  });

  app.post('/factories', requireAuth, async (req, res, next) => {
    try {
      const { name, location } = req.body;
      if (name && name.trim()) {
        await db.createFactory(name.trim(), (location || '').trim());
      }
      res.redirect('/');
    } catch (err) { next(err); }
  });

  app.post('/factories/:id/delete', requireAuth, async (req, res, next) => {
    try {
      await db.deleteFactory(req.params.id);
      res.redirect('/');
    } catch (err) { next(err); }
  });

  // ---------- FACTORY DETAIL: MACHINES ----------
  app.get('/factories/:id', requireAuth, async (req, res, next) => {
    try {
      const factory = await db.getFactory(req.params.id);
      if (!factory) return res.status(404).send('Заводът не е намерен.');
      const machines = await db.listMachinesByFactory(req.params.id);
      render(res, 'factory', { factory, machines, username: req.user.username });
    } catch (err) { next(err); }
  });

  app.post('/factories/:id/machines', requireAuth, async (req, res, next) => {
    try {
      const { name, model, serial_number } = req.body;
      if (name && name.trim()) {
        await db.createMachine(req.params.id, name.trim(), (model || '').trim(), (serial_number || '').trim());
      }
      res.redirect('/factories/' + req.params.id);
    } catch (err) { next(err); }
  });

  // ---------- MACHINE ADMIN VIEW ----------
  app.get('/machines/:id', requireAuth, async (req, res, next) => {
    try {
      const machine = await db.getMachine(req.params.id);
      if (!machine) return res.status(404).send('Машината не е намерена.');
      const factory = await db.getFactory(machine.factory_id);
      const records = await db.listRecordsByMachine(machine.id);
      const publicUrl = `${BASE_URL}/m/${machine.slug}`;
      render(res, 'machine_admin', { machine, factory, records, publicUrl, username: req.user.username });
    } catch (err) { next(err); }
  });

  app.post('/machines/:id/records', requireAuth, async (req, res, next) => {
    try {
      const { service_date, work_done, notes, technician } = req.body;
      if (service_date && work_done) {
        await db.createRecord(req.params.id, service_date, work_done.trim(), (notes || '').trim(), (technician || '').trim());
      }
      res.redirect('/machines/' + req.params.id);
    } catch (err) { next(err); }
  });

  app.post('/machines/:id/delete', requireAuth, async (req, res, next) => {
    try {
      const machine = await db.getMachine(req.params.id);
      if (!machine) return res.redirect('/');
      await db.deleteMachine(req.params.id);
      res.redirect('/factories/' + machine.factory_id);
    } catch (err) { next(err); }
  });

  app.post('/records/:id/delete', requireAuth, async (req, res, next) => {
    try {
      const record = await db.getRecord(req.params.id);
      if (!record) return res.redirect('/');
      await db.deleteRecord(req.params.id);
      res.redirect('/machines/' + record.machine_id);
    } catch (err) { next(err); }
  });

  // QR code PNG for a machine (admin only, to print/download)
  app.get('/machines/:id/qr.png', requireAuth, async (req, res, next) => {
    try {
      const machine = await db.getMachine(req.params.id);
      if (!machine) return res.status(404).end();
      const url = `${BASE_URL}/m/${machine.slug}`;
      const buffer = await QRCode.toBuffer(url, { width: 500, margin: 2 });
      res.type('png').send(buffer);
    } catch (err) { next(err); }
  });

  // ---------- PUBLIC MACHINE PAGE (scanned via QR, no login) ----------
  app.get('/m/:slug', async (req, res, next) => {
    try {
      const machine = await db.getMachineBySlug(req.params.slug);
      if (!machine) return render(res, 'public_not_found', {}, 404);
      const factory = await db.getFactory(machine.factory_id);
      const records = await db.listRecordsByMachine(machine.id);
      render(res, 'machine_public', { machine, factory, records });
    } catch (err) { next(err); }
  });

  // ---------- ERROR HANDLER ----------
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Възникна грешка на сървъра. Опитай отново след малко.');
  });

  return app;
}

module.exports = buildApp;
