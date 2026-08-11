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

async function createMachine(factoryId, name, model, serialNumber) {
  let slug;
  // extremely unlikely to collide, but guard anyway
  for (let attempt = 0; attempt < 5; attempt++) {
    slug = generateSlug();
    const existing = await getMachineBySlug(slug);
    if (!existing) break;
  }
  const { error } = await client().from('machines').insert({
    factory_id: factoryId, name, model, serial_number: serialNumber, slug
  });
  mustNotError(error, 'createMachine');
  return slug;
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

async function createRecord(machineId, serviceDate, workDone, notes, technician) {
  const { error } = await client().from('service_records').insert({
    machine_id: machineId, service_date: serviceDate, work_done: workDone, notes, technician
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

module.exports = {
  countUsers, getUserByUsername, createUser,
  listFactoriesWithMachineCount, getFactory, createFactory, deleteFactory,
  listMachinesByFactory, getMachine, getMachineBySlug, createMachine, deleteMachine,
  listRecordsByMachine, createRecord, getRecord, deleteRecord,
};
