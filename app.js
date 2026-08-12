const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const ejs = require('ejs');
const QRCode = require('qrcode');
const db = require('./db');
const { issueSession, clearSession, currentUser, requireAuth } = require('./auth');
const { fmtDate } = require('./dateFmt');
const { buildExcelReport, buildPdfReport, asciiSlug } = require('./reports');

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
    const html = ejs.render(tpl, Object.assign({ fmtDate }, data), { filename: name });
    if (statusCode) res.status(statusCode);
    res.type('html').send(html);
  }

  // Turns the posted form fields (cf_<key>) into a plain object keyed by
  // field definition key, only for fields that are currently defined.
  function collectCustomFieldValues(fieldDefs, body) {
    const values = {};
    for (const f of fieldDefs) {
      const raw = body['cf_' + f.key];
      if (raw === undefined) continue;
      values[f.key] = typeof raw === 'string' ? raw.trim() : raw;
    }
    return values;
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
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      render(res, 'factory', { factory, machines, machineFieldDefs, username: req.user.username });
    } catch (err) { next(err); }
  });

  app.post('/factories/:id/machines', requireAuth, async (req, res, next) => {
    try {
      const { name, model, serial_number } = req.body;
      if (name && name.trim()) {
        const machineFieldDefs = await db.listFieldDefinitions('machine');
        const customFields = collectCustomFieldValues(machineFieldDefs, req.body);
        await db.createMachine(req.params.id, name.trim(), (model || '').trim(), (serial_number || '').trim(), customFields);
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
      const recordFieldDefs = await db.listFieldDefinitions('record');
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      const publicUrl = `${BASE_URL}/m/${machine.slug}`;
      render(res, 'machine_admin', {
        machine, factory, records, recordFieldDefs, machineFieldDefs, publicUrl, username: req.user.username,
      });
    } catch (err) { next(err); }
  });

  app.get('/machines/:id/edit', requireAuth, async (req, res, next) => {
    try {
      const machine = await db.getMachine(req.params.id);
      if (!machine) return res.status(404).send('Машината не е намерена.');
      const factory = await db.getFactory(machine.factory_id);
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      render(res, 'machine_edit', { machine, factory, machineFieldDefs, username: req.user.username });
    } catch (err) { next(err); }
  });

  app.post('/machines/:id/edit', requireAuth, async (req, res, next) => {
    try {
      const { name, model, serial_number } = req.body;
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      const customFields = collectCustomFieldValues(machineFieldDefs, req.body);
      await db.updateMachine(req.params.id, {
        name: (name || '').trim(), model: (model || '').trim(), serialNumber: (serial_number || '').trim(), customFields,
      });
      res.redirect('/machines/' + req.params.id);
    } catch (err) { next(err); }
  });

  // "Статус на машина" — normal service entries require the usual fields,
  // but "В ремонт" / "Не се използва" just log the status itself with no
  // service work performed, so all the service-detail fields are optional.
  const MACHINE_STATUSES = ['Изправна', 'В ремонт', 'Не се използва'];

  app.post('/machines/:id/records', requireAuth, async (req, res, next) => {
    try {
      const { service_date, notes, technician, machine_status } = req.body;
      const status = MACHINE_STATUSES.includes(machine_status) ? machine_status : 'Изправна';

      if (!service_date) return res.redirect('/machines/' + req.params.id);

      if (status === 'Изправна') {
        // "Извършена работа" is a multi-select set of checkbox buttons —
        // normalize to an array (a single checked box arrives as a plain
        // string, multiple as an array) and join them.
        const raw = req.body.work_options;
        const workOptions = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const work_done = workOptions.join(', ');
        if (!work_done) return res.redirect('/machines/' + req.params.id);

        const recordFieldDefs = await db.listFieldDefinitions('record');
        const customFields = collectCustomFieldValues(recordFieldDefs, req.body);
        await db.createRecord(req.params.id, service_date, work_done, (notes || '').trim(), (technician || '').trim(), customFields);
      } else {
        // No actual service performed — just record the status.
        await db.createRecord(req.params.id, service_date, status, '', (technician || '').trim(), {});
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

  // ---------- FACTORY SERVICE REPORT (Excel / PDF, for sending to clients) ----------
  function parseReportRange(query) {
    const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return {
      from: isIsoDate(query.from) ? query.from : null,
      to: isIsoDate(query.to) ? query.to : null,
    };
  }

  async function gatherFactoryReportData(factoryId, from, to) {
    const factory = await db.getFactory(factoryId);
    if (!factory) return null;
    const machines = await db.listMachinesByFactory(factoryId);
    const recordFieldDefs = await db.listFieldDefinitions('record');
    const machineFieldDefs = await db.listFieldDefinitions('machine');
    const data = [];
    for (const machine of machines) {
      const allRecords = await db.listRecordsByMachine(machine.id);
      const records = allRecords
        .filter((r) => (!from || r.service_date >= from) && (!to || r.service_date <= to))
        .sort((a, b) => a.service_date.localeCompare(b.service_date));
      data.push({ machine, records });
    }
    return { factory, data, recordFieldDefs, machineFieldDefs };
  }

  app.get('/factories/:id/report.xlsx', requireAuth, async (req, res, next) => {
    try {
      const { from, to } = parseReportRange(req.query);
      const report = await gatherFactoryReportData(req.params.id, from, to);
      if (!report) return res.status(404).send('Заводът не е намерен.');
      const buffer = await buildExcelReport(report, from, to);
      res.set('Content-Disposition', `attachment; filename="spravka-${asciiSlug(report.factory.name)}.xlsx"`);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
    } catch (err) { next(err); }
  });

  app.get('/factories/:id/report.pdf', requireAuth, async (req, res, next) => {
    try {
      const { from, to } = parseReportRange(req.query);
      const report = await gatherFactoryReportData(req.params.id, from, to);
      if (!report) return res.status(404).send('Заводът не е намерен.');
      const buffer = await buildPdfReport(report, from, to);
      res.set('Content-Disposition', `attachment; filename="spravka-${asciiSlug(report.factory.name)}.pdf"`);
      res.type('application/pdf').send(buffer);
    } catch (err) { next(err); }
  });

  // ---------- CUSTOM FIELD DEFINITIONS (admin-configurable form fields) ----------
  app.get('/fields', requireAuth, async (req, res, next) => {
    try {
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      const recordFieldDefs = await db.listFieldDefinitions('record');
      render(res, 'fields', { machineFieldDefs, recordFieldDefs, username: req.user.username, editingField: null, error: null });
    } catch (err) { next(err); }
  });

  app.get('/fields/:id/edit', requireAuth, async (req, res, next) => {
    try {
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      const recordFieldDefs = await db.listFieldDefinitions('record');
      const editingField = await db.getFieldDefinition(req.params.id);
      render(res, 'fields', { machineFieldDefs, recordFieldDefs, username: req.user.username, editingField, error: null });
    } catch (err) { next(err); }
  });

  app.post('/fields', requireAuth, async (req, res, next) => {
    try {
      const { label, field_type, options, required, scope } = req.body;
      if (label && label.trim()) {
        const optionsList = (options || '').split(',').map(s => s.trim()).filter(Boolean);
        await db.createFieldDefinition({
          label: label.trim(), field_type: field_type || 'text', options: optionsList,
          required: required === 'on', scope: scope === 'machine' ? 'machine' : 'record',
        });
      }
      res.redirect('/fields');
    } catch (err) { next(err); }
  });

  app.post('/fields/:id/edit', requireAuth, async (req, res, next) => {
    try {
      const { label, field_type, options, required } = req.body;
      const optionsList = (options || '').split(',').map(s => s.trim()).filter(Boolean);
      await db.updateFieldDefinition(req.params.id, {
        label: (label || '').trim(), field_type: field_type || 'text', options: optionsList, required: required === 'on',
      });
      res.redirect('/fields');
    } catch (err) { next(err); }
  });

  app.post('/fields/:id/delete', requireAuth, async (req, res, next) => {
    try {
      await db.deleteFieldDefinition(req.params.id);
      res.redirect('/fields');
    } catch (err) { next(err); }
  });

  app.post('/fields/:id/move-up', requireAuth, async (req, res, next) => {
    try {
      await db.moveFieldDefinition(req.params.id, 'up');
      res.redirect('/fields');
    } catch (err) { next(err); }
  });

  app.post('/fields/:id/move-down', requireAuth, async (req, res, next) => {
    try {
      await db.moveFieldDefinition(req.params.id, 'down');
      res.redirect('/fields');
    } catch (err) { next(err); }
  });

  // ---------- PUBLIC MACHINE PAGE (scanned via QR, no login) ----------
  app.get('/m/:slug', async (req, res, next) => {
    try {
      const machine = await db.getMachineBySlug(req.params.slug);
      if (!machine) return render(res, 'public_not_found', {}, 404);
      const factory = await db.getFactory(machine.factory_id);
      const records = await db.listRecordsByMachine(machine.id);
      const recordFieldDefs = await db.listFieldDefinitions('record');
      const machineFieldDefs = await db.listFieldDefinitions('machine');
      render(res, 'machine_public', { machine, factory, records, recordFieldDefs, machineFieldDefs });
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
