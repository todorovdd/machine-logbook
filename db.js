const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let _client = null;
function client() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Липсват SUPABASE_URL / SUPABASE_SERVICE_KEY в environment variables.');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function mustNotError(error, context) {
  if (error) {
    const e = new Error(`[db:${context}] ${error.message}`);
    e.cause = error;
    throw e;
  }
}

function generateSlug() {
  return crypto.randomBytes(5).toString('hex');
}

// ---------- USERS ----------
async function countUsers() {
  const { count, error } = await client().from('users').select('*', { count: 'exact', head: true });
  mustNotError(error, 'countUsers');
  return count || 0;
}

async function getUserByUsername(username) {
  const { data, error } = await client().from('users').select('*').eq('username', username).maybeSingle();
  mustNotError(error, 'getUserByUsername');
  return data;
}

async function createUser(username, passwordHash) {
  const { error } = await client().from('users').insert({ username, password_hash: passwordHash });
  mustNotError(error, 'createUser');
}

// ---------- FACTORIES ----------
async function listFactoriesWithMachineCount() {
  const { data: factories, error } = await client().from('factories').select('*').order('name', { ascending: true });
  mustNotError(error, 'listFactories');
  if (!factories.length) return [];

  const { data: machines, error: mErr } = await client().from('machines').select('id, factory_id');
  mustNotError(mErr, 'listFactories.machines');

  const counts = {};
  for (const m of machines) counts[m.factory_id] = (counts[m.factory_id] || 0) + 1;

  return factories.map(f => ({ ...f, machine_count: counts[f.id] || 0 }));
}

async function getFactory(id) {
  const { data, error } = await client().from('factories').select('*').eq('id', id).maybeSingle();
  mustNotError(error, 'getFactory');
  return data;
}

async function createFactory(name, location) {
  const { error } = await client().from('factories').insert({ name, location });
  mustNotError(error, 'createFactory');
}

async function deleteFactory(id) {
  const { error } = await client().from('factories').delete().eq('id', id);
  mustNotError(error, 'deleteFactory');
}

// ---------- MACHINES ----------
async function listMachinesByFactory(factoryId) {
  const { data: machines, error } = await client()
    .from('machines').select('*').eq('factory_id', factoryId).order('name', { ascending: true });
  mustNotError(error, 'listMachinesByFactory');
  if (!machines.length) return [];

  const ids = machines.map(m => m.id);
  const { data: records, error: rErr } = await client()
    .from('service_records')
    .select('machine_id, service_date')
    .in('machine_id', ids)
    .order('service_date', { ascending: false });
  mustNotError(rErr, 'listMachinesByFactory.records');

  const lastByMachine = {};
  for (const r of records) {
    if (!lastByMachine[r.machine_id]) lastByMachine[r.machine_id] = r.service_date;
  }
  return machines.map(m => ({ ...m, last_service_date: lastByMachine[m.id] || null }));
}

async function getMachine(id) {
  const { data, error } = await client().from('machines').select('*').eq('id', id).maybeSingle();
  mustNotError(error, 'getMachine');
  return data;
}

async function getMachineBySlug(slug) {
  const { data, error } = await client().from('machines').select('*').eq('slug', slug).maybeSingle();
  mustNotError(error, 'getMachineBySlug');
  return data;
}

async function createMachine(factoryId, name, model, serialNumber, customFields) {
  let slug;
  // extremely unlikely to collide, but guard anyway
  for (let attempt = 0; attempt < 5; attempt++) {
    slug = generateSlug();
    const existing = await getMachineBySlug(slug);
    if (!existing) break;
  }
  const { error } = await client().from('machines').insert({
    factory_id: factoryId, name, model, serial_number: serialNumber, slug,
    custom_fields: customFields || {},
  });
  mustNotError(error, 'createMachine');
  return slug;
}

async function updateMachine(id, { name, model, serialNumber, customFields }) {
  const { error } = await client().from('machines').update({
    name, model, serial_number: serialNumber, custom_fields: customFields || {},
  }).eq('id', id);
  mustNotError(error, 'updateMachine');
}

async function deleteMachine(id) {
  const { error } = await client().from('machines').delete().eq('id', id);
  mustNotError(error, 'deleteMachine');
}

// ---------- SERVICE RECORDS ----------
async function listRecordsByMachine(machineId) {
  const { data, error } = await client()
    .from('service_records').select('*').eq('machine_id', machineId)
    .order('service_date', { ascending: false })
    .order('id', { ascending: false });
  mustNotError(error, 'listRecordsByMachine');
  return data;
}

async function createRecord(machineId, serviceDate, workDone, notes, technician, customFields) {
  const { error } = await client().from('service_records').insert({
    machine_id: machineId, service_date: serviceDate, work_done: workDone, notes, technician,
    custom_fields: customFields || {},
  });
  mustNotError(error, 'createRecord');
}

async function getRecord(id) {
  const { data, error } = await client().from('service_records').select('*').eq('id', id).maybeSingle();
  mustNotError(error, 'getRecord');
  return data;
}

async function deleteRecord(id) {
  const { error } = await client().from('service_records').delete().eq('id', id);
  mustNotError(error, 'deleteRecord');
}

// ---------- CUSTOM FIELD DEFINITIONS ----------
// Lets the admin add/edit/remove/reorder extra fields that show up on the
// "add service record" form and on every record display, without touching
// code — the definitions themselves live in the database.
async function listFieldDefinitions(scope) {
  let q = client().from('field_definitions').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true });
  if (scope) q = q.eq('scope', scope);
  const { data, error } = await q;
  mustNotError(error, 'listFieldDefinitions');
  return data;
}

async function getFieldDefinition(id) {
  const { data, error } = await client().from('field_definitions').select('*').eq('id', id).maybeSingle();
  mustNotError(error, 'getFieldDefinition');
  return data;
}

function slugifyKey(label) {
  const base = label.toLowerCase()
    .replace(/[а-яё]/g, ch => ({ а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sht',ъ:'a',ь:'',ю:'yu',я:'ya' }[ch] || ch))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (base || 'field') + '_' + crypto.randomBytes(2).toString('hex');
}

async function createFieldDefinition({ label, field_type, options, required, scope }) {
  const key = slugifyKey(label);
  const useScope = scope === 'machine' ? 'machine' : 'record';
  const { data: existing, error: cErr } = await client().from('field_definitions')
    .select('sort_order').eq('scope', useScope).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  mustNotError(cErr, 'createFieldDefinition.maxOrder');
  const nextOrder = existing ? existing.sort_order + 1 : 0;

  const { error } = await client().from('field_definitions').insert({
    key, label, field_type, options: options && options.length ? options : null,
    required: !!required, scope: useScope, sort_order: nextOrder,
  });
  mustNotError(error, 'createFieldDefinition');
  return key;
}

async function updateFieldDefinition(id, { label, field_type, options, required }) {
  const { error } = await client().from('field_definitions').update({
    label, field_type, options: options && options.length ? options : null, required: !!required,
  }).eq('id', id);
  mustNotError(error, 'updateFieldDefinition');
}

async function deleteFieldDefinition(id) {
  const { error } = await client().from('field_definitions').delete().eq('id', id);
  mustNotError(error, 'deleteFieldDefinition');
}

async function moveFieldDefinition(id, direction) {
  const field = await getFieldDefinition(id);
  if (!field) return;
  const all = await listFieldDefinitions(field.scope);
  const idx = all.findIndex(f => String(f.id) === String(id));
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return;

  const a = all[idx];
  const b = all[swapIdx];
  const { error: e1 } = await client().from('field_definitions').update({ sort_order: b.sort_order }).eq('id', a.id);
  mustNotError(e1, 'moveFieldDefinition.a');
  const { error: e2 } = await client().from('field_definitions').update({ sort_order: a.sort_order }).eq('id', b.id);
  mustNotError(e2, 'moveFieldDefinition.b');
}

module.exports = {
  countUsers, getUserByUsername, createUser,
  listFactoriesWithMachineCount, getFactory, createFactory, deleteFactory,
  listMachinesByFactory, getMachine, getMachineBySlug, createMachine, updateMachine, deleteMachine,
  listRecordsByMachine, createRecord, getRecord, deleteRecord,
  listFieldDefinitions, getFieldDefinition, createFieldDefinition, updateFieldDefinition,
  deleteFieldDefinition, moveFieldDefinition,
};
