// server.js - Backend for Tukang & Material Management System
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'app.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

const db = new DatabaseSync(DB_PATH);

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// Create tables
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialist TEXT NOT NULL,
    is_mandor INTEGER DEFAULT 0,
    mandor_id INTEGER DEFAULT NULL,
    daily_wage REAL NOT NULL DEFAULT 0,
    hourly_overtime_rate REAL NOT NULL DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS worker_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    weekly_term REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(worker_id) REFERENCES workers(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    date TEXT PRIMARY KEY,
    submitter_name TEXT,
    corrector_names TEXT DEFAULT '',
    submitted_at TEXT,
    corrected_at TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    worker_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    sick_allowance REAL DEFAULT 0,
    job_description TEXT DEFAULT '',
    overtime_hours REAL DEFAULT 0,
    extra_days REAL DEFAULT 0,
    overtime_note TEXT DEFAULT '',
    UNIQUE(date, worker_id),
    FOREIGN KEY(worker_id) REFERENCES workers(id)
  );

  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock_yesterday REAL DEFAULT 0,
    in_today REAL DEFAULT 0,
    out_today REAL DEFAULT 0,
    stock_today REAL DEFAULT 0,
    min_stock REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS material_rollover_log (
    date TEXT PRIMARY KEY,
    rolled_over_at TEXT
  );

  CREATE TABLE IF NOT EXISTS weekly_rollover_log (
    sunday_date TEXT PRIMARY KEY,
    reset_at TEXT
  );

  CREATE TABLE IF NOT EXISTS material_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    material_id INTEGER NOT NULL,
    stock_yesterday REAL,
    in_qty REAL,
    out_qty REAL,
    stock_final REAL,
    FOREIGN KEY(material_id) REFERENCES materials(id)
  );
`);

// Alter table migrations if necessary
try { db.exec('ALTER TABLE workers ADD COLUMN is_mandor INTEGER DEFAULT 0'); } catch(e){}
try { db.exec('ALTER TABLE workers ADD COLUMN archived_at TEXT'); } catch(e){}
try { db.exec('ALTER TABLE attendance_records ADD COLUMN extra_days REAL DEFAULT 0'); } catch(e){}
try { db.exec('ALTER TABLE attendance_records ADD COLUMN overtime_note TEXT DEFAULT ""'); } catch(e){}
try { db.exec('ALTER TABLE attendance_sessions ADD COLUMN corrector_names TEXT DEFAULT ""'); } catch(e){}

// Convert old 'Kayu' to 'Tukang Kayu'
db.exec("UPDATE workers SET specialist = 'Tukang Kayu' WHERE specialist = 'Kayu'");

const getSetting = (key, defaultVal) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
};

const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
};

if (!getSetting('admin_pin', null)) setSetting('admin_pin', '1234');
if (!getSetting('company_name', null)) setSetting('company_name', 'PT KARYA CIPTA KONSTRUKSI');
if (!getSetting('project_name', null)) setSetting('project_name', 'Proyek Pembangunan Gedung & Hunian');

// 10 Contoh Tukang Realistis:
// Mandor adalah status (is_mandor = 1) dengan keahliannya. "Tukang Kayu" menggantikan "Kayu".
function seed10Workers() {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM attendance_records;
    DELETE FROM worker_loans;
    DELETE FROM workers;
    PRAGMA foreign_keys = ON;
  `);

  const insert = db.prepare(`
    INSERT INTO workers (name, specialist, is_mandor, mandor_id, daily_wage, hourly_overtime_rate, is_archived)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);

  // Mandor 1: Pakde Sutrisno (Spesialis: Tukang Besi, Status: Mandor ⭐)
  const m1 = insert.run('Pakde Sutrisno', 'Tukang Besi', 1, null, 250000, 31250);
  const m1Id = Number(m1.lastInsertRowid);

  // Anggota Tim Pakde Sutrisno
  insert.run('Wawan Kurniawan', 'Tukang Besi', 0, m1Id, 185000, 23000);
  insert.run('Dedi Kusnadi', 'Tukang Besi', 0, m1Id, 180000, 22500);
  insert.run('Slamet Riyadi', 'Tk Batu', 0, m1Id, 175000, 21875);
  insert.run('Sugeng Priyanto', 'Tenaga', 0, m1Id, 130000, 16250);

  // Mandor 2: Herman Susilo (Spesialis: Tukang Kayu, Status: Mandor ⭐)
  const m2 = insert.run('Herman Susilo', 'Tukang Kayu', 1, null, 250000, 31250);
  const m2Id = Number(m2.lastInsertRowid);

  // Anggota Tim Herman Susilo
  insert.run('Karyo Mulyono', 'Tukang Kayu', 0, m2Id, 180000, 22500);
  insert.run('Rian Ardiansyah', 'Tukang Kayu', 0, m2Id, 185000, 23000);
  insert.run('Eko Prasetyo', 'Elektrikal', 0, m2Id, 195000, 24375);
  insert.run('Aris Munandar', 'Plumbing', 0, m2Id, 190000, 23750);
}

// 10 Contoh Material Proyek
function seed10Materials() {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM material_history;
    DELETE FROM materials;
    PRAGMA foreign_keys = ON;
  `);

  const insert = db.prepare(`
    INSERT INTO materials (category, name, unit, stock_yesterday, in_today, out_today, stock_today, min_stock, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('Struktur', 'Besi Beton Ulir 16mm', 'Btg', 120, 25, 40, 105, 30, 1);
  insert.run('Struktur', 'Besi Beton Polos 10mm', 'Btg', 210, 0, 35, 175, 50, 2);
  insert.run('Struktur', 'Semen Portland Gresik 50kg', 'Sak', 85, 50, 30, 105, 40, 3);
  insert.run('Struktur', 'Pasir Pasang Cor', 'M3', 18, 12, 6, 24, 10, 4);
  insert.run('Arsitektur', 'Bata Ringan Hebel 10cm', 'M3', 42, 20, 15, 47, 15, 5);
  insert.run('Arsitektur', 'Semen Mortar Perekat Hebel', 'Sak', 64, 10, 18, 56, 20, 6);
  insert.run('Arsitektur', 'Granit Tile 60x60 Cream Polos', 'Dus', 95, 0, 22, 73, 25, 7);
  insert.run('MEP', 'Pipa PVC AW 3 Inch Wavin', 'Btg', 32, 15, 8, 39, 12, 8);
  insert.run('MEP', 'Kabel Elektrikal NYM 3x2.5mm', 'Roll', 14, 5, 3, 16, 5, 9);
  insert.run('Inventaris Kantor', 'Rompi Safety Scotlight & Helm', 'Pcs', 28, 0, 2, 26, 8, 10);
}

const countWorkers = db.prepare('SELECT COUNT(*) as c FROM workers').get().c;
if (countWorkers === 0) seed10Workers();

const countMaterials = db.prepare('SELECT COUNT(*) as c FROM materials').get().c;
if (countMaterials === 0) seed10Materials();

let sseClients = [];

function notifyClients(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try { client.res.write(message); } catch (e) {}
  });
}

function getWIBDateObj() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 3600000);
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 07:00 AM WIB Rollover & Auto Reset
function checkDailyRollover() {
  const wib = getWIBDateObj();
  const hours = wib.getHours();
  const currentDateStr = formatDate(wib);

  if (hours >= 7) {
    // 1. Material Daily Rollover (Setiap Hari jam 07:00 WIB)
    const alreadyRolled = db.prepare('SELECT date FROM material_rollover_log WHERE date = ?').get(currentDateStr);
    if (!alreadyRolled) {
      console.log(`[ROLLOVER] Executing 07:00 AM WIB material rollover for ${currentDateStr}...`);
      const yesterdayObj = new Date(wib.getTime() - 24 * 3600000);
      const yesterdayDateStr = formatDate(yesterdayObj);

      const allMaterials = db.prepare('SELECT * FROM materials').all();
      const insertHistory = db.prepare(`
        INSERT INTO material_history (date, material_id, stock_yesterday, in_qty, out_qty, stock_final)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const updateMaterial = db.prepare(`
        UPDATE materials
        SET stock_yesterday = stock_today,
            in_today = 0,
            out_today = 0,
            stock_today = stock_today
        WHERE id = ?
      `);

      for (const mat of allMaterials) {
        insertHistory.run(yesterdayDateStr, mat.id, mat.stock_yesterday, mat.in_today, mat.out_today, mat.stock_today);
        updateMaterial.run(mat.id);
      }

      db.prepare('INSERT INTO material_rollover_log (date, rolled_over_at) VALUES (?, ?)').run(
        currentDateStr,
        wib.toISOString()
      );
      console.log(`[ROLLOVER] Material rollover finished successfully for yesterday (${yesterdayDateStr}).`);
      notifyClients({ type: 'materials_updated' });
    }

    // 2. Auto-Reset Siklus Mingguan (Setiap Hari Minggu jam 07:00 WIB)
    if (wib.getDay() === 0) { // 0 = Hari Minggu
      const alreadyResetWeek = db.prepare('SELECT sunday_date FROM weekly_rollover_log WHERE sunday_date = ?').get(currentDateStr);
      if (!alreadyResetWeek) {
        console.log(`[WEEKLY RESET] Auto-reset siklus mingguan hari Minggu jam 07:00 WIB (${currentDateStr})...`);
        const activeLoans = db.prepare('SELECT * FROM worker_loans WHERE remaining_amount > 0').all();
        const updateLoan = db.prepare('UPDATE worker_loans SET remaining_amount = ? WHERE id = ?');
        
        for (const l of activeLoans) {
          const deduct = Math.min(l.weekly_term, l.remaining_amount);
          const newRem = Math.max(0, l.remaining_amount - deduct);
          updateLoan.run(newRem, l.id);
        }

        db.prepare('INSERT OR IGNORE INTO weekly_rollover_log (sunday_date, reset_at) VALUES (?, ?)').run(
          currentDateStr,
          wib.toISOString()
        );
        console.log(`[WEEKLY RESET] Potongan kasbon mingguan berhasil diproses otomatis.`);
        notifyClients({ type: 'payroll_reset', date: currentDateStr });
      }
    }
  }
}

checkDailyRollover();
setInterval(checkDailyRollover, 60000);

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(data));
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// DEFINISI 4 KATEGORI STATUS KEHADIRAN:
// 1. TK Besi: Tukang Besi
// 2. Tukang Kayu: Tukang Kayu
// 3. Tukang: MELIPUTI Tk Batu & Tenaga (Mandor DIHAPUS dari kategori ini!)
// 4. MEP: MELIPUTI Elektrikal / Listrik, Plumbing, Mekanikal / Hydrant
function getSpecialistGroup(specialist) {
  const spec = (specialist || '').toLowerCase();
  if (spec.includes('besi')) return 'TK Besi';
  if (spec.includes('kayu')) return 'Tukang Kayu';
  if (spec.includes('listrik') || spec.includes('elektrik') || spec.includes('plumbing') || spec.includes('mekanik') || spec.includes('hydrant') || spec.includes('mep')) {
    return 'MEP';
  }
  if (spec.includes('batu') || spec.includes('tenaga')) {
    return 'Tukang';
  }
  return 'Tukang';
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // SSE Stream
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 5000\n\n');
    const clientId = Date.now();
    sseClients.push({ id: clientId, res });

    req.on('close', () => {
      sseClients = sseClients.filter(c => c.id !== clientId);
    });
    return;
  }

  // --- API ROUTES ---

  // 1. Info & Settings
  if (pathname === '/api/info' && req.method === 'GET') {
    const localIp = getLocalIp();
    return sendJson(res, 200, {
      localIp,
      port: PORT,
      fullUrl: `http://${localIp}:${PORT}`,
      companyName: getSetting('company_name', 'PT KARYA CIPTA KONSTRUKSI'),
      projectName: getSetting('project_name', 'Proyek Pembangunan Gedung & Hunian'),
      serverTimeWIB: getWIBDateObj().toISOString()
    });
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (body.companyName) setSetting('company_name', body.companyName);
      if (body.projectName) setSetting('project_name', body.projectName);
      if (body.adminPin) setSetting('admin_pin', body.adminPin);
      notifyClients({ type: 'settings_updated' });
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 2. Verify PIN
  if (pathname === '/api/auth/verify-pin' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const correctPin = getSetting('admin_pin', '1234');
      if (body.pin === correctPin) {
        return sendJson(res, 200, { valid: true });
      }
      return sendJson(res, 401, { valid: false, message: 'PIN Admin Salah!' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 3. Reset/Seed Examples
  if (pathname === '/api/seed/workers' && req.method === 'POST') {
    seed10Workers();
    notifyClients({ type: 'workers_updated' });
    return sendJson(res, 200, { success: true, message: '10 Data Contoh Tukang Berhasil Dimuat!' });
  }

  if (pathname === '/api/seed/materials' && req.method === 'POST') {
    seed10Materials();
    notifyClients({ type: 'materials_updated' });
    return sendJson(res, 200, { success: true, message: '10 Data Contoh Material Berhasil Dimuat!' });
  }

  // 4. Workers API
  if (pathname === '/api/workers' && req.method === 'GET') {
    const workers = db.prepare(`
      SELECT w.*, m.name as mandor_name 
      FROM workers w
      LEFT JOIN workers m ON w.mandor_id = m.id
      WHERE w.is_archived = 0
      ORDER BY 
        COALESCE(w.mandor_id, w.id) ASC,
        w.is_mandor DESC,
        w.id ASC
    `).all();
    return sendJson(res, 200, workers);
  }

  if (pathname === '/api/workers/archived' && req.method === 'GET') {
    const workers = db.prepare(`
      SELECT w.*, m.name as mandor_name 
      FROM workers w
      LEFT JOIN workers m ON w.mandor_id = m.id
      WHERE w.is_archived = 1
      ORDER BY w.archived_at DESC, w.name ASC
    `).all();
    return sendJson(res, 200, workers);
  }

  if (pathname === '/api/workers' && req.method === 'POST') {
    try {
      const b = await parseJsonBody(req);
      const isMandor = b.is_mandor ? 1 : 0;
      const mandorId = isMandor ? null : (b.mandor_id ? parseInt(b.mandor_id, 10) : null);
      
      const info = db.prepare(`
        INSERT INTO workers (name, specialist, is_mandor, mandor_id, daily_wage, hourly_overtime_rate, is_archived)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(b.name, b.specialist, isMandor, mandorId, b.daily_wage || 0, b.hourly_overtime_rate || 0);
      
      notifyClients({ type: 'workers_updated' });
      return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname.startsWith('/api/workers/') && req.method === 'PUT') {
    const id = parseInt(pathname.split('/')[3], 10);
    try {
      const b = await parseJsonBody(req);
      const isMandor = b.is_mandor ? 1 : 0;
      const mandorId = isMandor ? null : (b.mandor_id ? parseInt(b.mandor_id, 10) : null);

      db.prepare(`
        UPDATE workers
        SET name = ?, specialist = ?, is_mandor = ?, mandor_id = ?, daily_wage = ?, hourly_overtime_rate = ?
        WHERE id = ?
      `).run(b.name, b.specialist, isMandor, mandorId, b.daily_wage, b.hourly_overtime_rate, id);

      notifyClients({ type: 'workers_updated' });
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname.startsWith('/api/workers/') && pathname.endsWith('/archive') && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const now = new Date().toISOString();
    db.prepare('UPDATE workers SET is_archived = 1, archived_at = ? WHERE id = ?').run(now, id);
    notifyClients({ type: 'workers_updated' });
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/workers/') && pathname.endsWith('/restore') && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    db.prepare('UPDATE workers SET is_archived = 0, archived_at = NULL WHERE id = ?').run(id);
    notifyClients({ type: 'workers_updated' });
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/workers/') && req.method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3], 10);
    db.prepare('DELETE FROM workers WHERE id = ?').run(id);
    notifyClients({ type: 'workers_updated' });
    return sendJson(res, 200, { success: true });
  }

  // 5. Loans (Kasbon) API - SANGAT KOKOH & BEBAS ERROR ID
  if (pathname === '/api/loans' && req.method === 'GET') {
    const loans = db.prepare(`
      SELECT l.*, w.name as worker_name, w.specialist, w.is_mandor
      FROM worker_loans l
      JOIN workers w ON l.worker_id = w.id
      WHERE l.remaining_amount > 0
      ORDER BY l.created_at DESC
    `).all();
    return sendJson(res, 200, loans);
  }

  if (pathname === '/api/loans' && req.method === 'POST') {
    try {
      const b = await parseJsonBody(req);
      const workerId = parseInt(b.worker_id, 10);
      const totalAmount = parseFloat(b.total_amount) || 0;
      const weeklyTerm = parseFloat(b.weekly_term) || 0;

      if (!workerId || isNaN(workerId)) {
        return sendJson(res, 400, { error: 'ID Tukang tidak valid. Harap pilih tukang kembali.' });
      }

      const worker = db.prepare('SELECT id, name FROM workers WHERE id = ?').get(workerId);
      if (!worker) {
        return sendJson(res, 404, { error: `Tukang dengan ID ${workerId} tidak ditemukan. Silakan refresh data tukang.` });
      }

      if (totalAmount <= 0 || weeklyTerm <= 0) {
        return sendJson(res, 400, { error: 'Nominal kasbon dan termin per minggu harus lebih dari 0!' });
      }

      const info = db.prepare(`
        INSERT INTO worker_loans (worker_id, total_amount, weekly_term, remaining_amount, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(workerId, totalAmount, weeklyTerm, totalAmount, b.note || '');

      notifyClients({ type: 'loans_updated' });
      return sendJson(res, 201, {
        id: Number(info.lastInsertRowid),
        success: true,
        message: `Kasbon Rp ${totalAmount.toLocaleString('id-ID')} untuk ${worker.name} berhasil disimpan.`
      });
    } catch (err) {
      console.error('[LOAN POST ERROR]', err);
      return sendJson(res, 500, { error: 'Gagal memproses kasbon: ' + err.message });
    }
  }

  // 6. Attendance API (STABLE ORDERING & MULTI-CORRECTOR LOG)
  if (pathname === '/api/attendance' && req.method === 'GET') {
    const date = urlObj.searchParams.get('date') || formatDate(getWIBDateObj());
    const session = db.prepare('SELECT * FROM attendance_sessions WHERE date = ?').get(date);
    
    // Urutan DETERMINISTIK & KONSISTEN: Grup Mandor tetap, Mandor di atas, anggota A-Z
    const records = db.prepare(`
      SELECT ar.id as attendance_id, ar.date, ar.status, ar.sick_allowance, ar.job_description, ar.overtime_hours, ar.extra_days, ar.overtime_note,
             w.id as worker_id, w.name, w.specialist, w.is_mandor, w.mandor_id, w.daily_wage, w.hourly_overtime_rate,
             m.name as mandor_name
      FROM workers w
      LEFT JOIN workers m ON w.mandor_id = m.id
      LEFT JOIN attendance_records ar ON ar.worker_id = w.id AND ar.date = ?
      WHERE w.is_archived = 0
      ORDER BY 
        COALESCE(w.mandor_id, w.id) ASC,
        w.is_mandor DESC,
        w.id ASC
    `).all(date);

    return sendJson(res, 200, {
      date,
      session: session || null,
      records
    });
  }

  if (pathname === '/api/attendance/process' && req.method === 'POST') {
    try {
      const b = await parseJsonBody(req);
      const { date, submitter_name, records } = b;

      if (!date || !submitter_name || !submitter_name.trim()) {
        return sendJson(res, 400, { error: 'Tanggal dan Nama Petugas wajib diisi!' });
      }

      const inputName = submitter_name.trim();
      const existingSession = db.prepare('SELECT * FROM attendance_sessions WHERE date = ?').get(date);
      const nowIso = new Date().toISOString();

      if (!existingSession) {
        // First submitter
        db.prepare(`
          INSERT INTO attendance_sessions (date, submitter_name, corrector_names, submitted_at, corrected_at)
          VALUES (?, ?, '', ?, NULL)
        `).run(date, inputName, nowIso);
      } else {
        // Subsequent submitters are CORRECTORS (bisa lebih dari 1 orang dan lebih dari 1 kali)
        let correctorList = existingSession.corrector_names ? existingSession.corrector_names.split(',').map(s => s.trim()).filter(Boolean) : [];
        
        // Add corrector if not just identical to the immediate last or if new
        if (inputName !== existingSession.submitter_name) {
          if (!correctorList.includes(inputName)) {
            correctorList.push(inputName);
          }
        } else {
          // If the original submitter edits again, also log correction if different
          if (correctorList.length === 0) correctorList.push(`${inputName} (Revisi)`);
        }

        const newCorrectorStr = correctorList.join(', ');

        db.prepare(`
          UPDATE attendance_sessions 
          SET corrector_names = ?, corrected_at = ?
          WHERE date = ?
        `).run(newCorrectorStr, nowIso, date);
      }

      const upsert = db.prepare(`
        INSERT INTO attendance_records (date, worker_id, status, sick_allowance, job_description, overtime_hours, extra_days, overtime_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, worker_id) DO UPDATE SET
          status = excluded.status,
          sick_allowance = excluded.sick_allowance,
          job_description = excluded.job_description,
          overtime_hours = excluded.overtime_hours,
          extra_days = excluded.extra_days,
          overtime_note = excluded.overtime_note
      `);

      for (const rec of (records || [])) {
        upsert.run(
          date,
          rec.worker_id,
          rec.status || 'hadir',
          parseFloat(rec.sick_allowance) || 0,
          rec.job_description || '',
          parseFloat(rec.overtime_hours) || 0,
          parseFloat(rec.extra_days) || 0,
          rec.overtime_note || ''
        );
      }

      notifyClients({ type: 'attendance_updated', date });
      return sendJson(res, 200, { success: true, message: 'Absensi berhasil disimpan.' });
    } catch (err) {
      console.error('[ATTENDANCE PROCESS ERROR]', err);
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 7. Dashboard API
  if (pathname === '/api/dashboard' && req.method === 'GET') {
    const todayDate = formatDate(getWIBDateObj());
    const yesterdayObj = new Date(getWIBDateObj().getTime() - 24 * 3600000);
    const yesterdayDate = formatDate(yesterdayObj);

    const todaySession = db.prepare('SELECT * FROM attendance_sessions WHERE date = ?').get(todayDate);

    const todayRecords = db.prepare(`
      SELECT ar.*, w.name, w.specialist, w.is_mandor, w.mandor_id
      FROM attendance_records ar
      JOIN workers w ON ar.worker_id = w.id
      WHERE ar.date = ? AND w.is_archived = 0
      ORDER BY COALESCE(w.mandor_id, w.id) ASC, w.is_mandor DESC, w.id ASC
    `).all(todayDate);

    const yesterdayRecords = db.prepare(`
      SELECT ar.*, w.specialist, w.is_mandor
      FROM attendance_records ar
      JOIN workers w ON ar.worker_id = w.id
      WHERE ar.date = ? AND w.is_archived = 0 AND ar.status IN ('hadir', 'setengah_hari')
    `).all(yesterdayDate);

    // KATEGORI 4 KARTU:
    // 1. TK Besi
    // 2. Tukang Kayu
    // 3. Tukang (Tk Batu & Tenaga; Mandor TIDAK masuk ke sini jika bukan batu/tenaga)
    // 4. MEP (Elektrikal, Plumbing, Mekanikal)
    const groups = ['TK Besi', 'Tukang Kayu', 'Tukang', 'MEP'];
    const groupStatsToday = { 'TK Besi': 0, 'Tukang Kayu': 0, 'Tukang': 0, 'MEP': 0 };
    const groupStatsYesterday = { 'TK Besi': 0, 'Tukang Kayu': 0, 'Tukang': 0, 'MEP': 0 };

    todayRecords.forEach(r => {
      if (r.status === 'hadir' || r.status === 'setengah_hari') {
        const g = getSpecialistGroup(r.specialist);
        groupStatsToday[g] = (groupStatsToday[g] || 0) + 1;
      }
    });

    yesterdayRecords.forEach(r => {
      const g = getSpecialistGroup(r.specialist);
      groupStatsYesterday[g] = (groupStatsYesterday[g] || 0) + 1;
    });

    const categoryAttendanceCards = groups.map(grpName => {
      const countToday = groupStatsToday[grpName] || 0;
      const countYest = groupStatsYesterday[grpName] || 0;
      const diff = countToday - countYest;
      let badgeText = '';
      if (countYest > 0 || countToday > 0) {
        if (diff > 0) badgeText = `(+${diff})`;
        else if (diff < 0) badgeText = `(${diff})`;
      }
      return {
        category: grpName,
        countToday,
        countYesterday: countYest,
        diff,
        badgeText
      };
    });

    const totalPresent = todayRecords.filter(r => r.status === 'hadir' || r.status === 'setengah_hari').length;
    const totalHalfDay = todayRecords.filter(r => r.status === 'setengah_hari').length;
    const totalSick = todayRecords.filter(r => r.status === 'sakit').length;
    const totalAbsent = todayRecords.filter(r => r.status === 'tidak_hadir').length;

    // Laporan pekerjaan simpel: mengikuti absensi tukang hari itu
    const simpleJobsList = todayRecords
      .filter(r => (r.status === 'hadir' || r.status === 'setengah_hari') && r.job_description && r.job_description.trim() !== '')
      .map(r => ({
        name: r.name,
        specialist: r.is_mandor ? `⭐ Mandor (${r.specialist})` : r.specialist,
        job: r.job_description.trim(),
        status: r.status
      }));

    // Low stock materials
    const lowStockMaterials = db.prepare(`
      SELECT * FROM materials 
      WHERE stock_today <= min_stock AND min_stock > 0
      ORDER BY (stock_today - min_stock) ASC
    `).all();

    // Line/Combo chart data
    const historicalMaterials = db.prepare(`
      SELECT date, SUM(in_qty) as total_in, SUM(out_qty) as total_out
      FROM material_history
      GROUP BY date
      ORDER BY date DESC
      LIMIT 7
    `).all().reverse();

    return sendJson(res, 200, {
      date: todayDate,
      session: todaySession || null,
      totalPresent,
      totalHalfDay,
      totalSick,
      totalAbsent,
      categoryAttendanceCards,
      simpleJobsList,
      lowStockMaterials,
      historicalMaterials
    });
  }

  // 8. Materials API
  if (pathname === '/api/materials' && req.method === 'GET') {
    const materials = db.prepare(`
      SELECT * FROM materials
      ORDER BY category ASC, id ASC
    `).all();
    return sendJson(res, 200, materials);
  }

  if (pathname === '/api/materials' && req.method === 'POST') {
    try {
      const b = await parseJsonBody(req);
      const stockInit = parseFloat(b.stock_initial) || 0;
      const minStock = parseFloat(b.min_stock) || 0;
      
      const info = db.prepare(`
        INSERT INTO materials (category, name, unit, stock_yesterday, in_today, out_today, stock_today, min_stock, sort_order)
        VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0)
      `).run(b.category, b.name, b.unit, stockInit, stockInit, minStock);

      notifyClients({ type: 'materials_updated' });
      return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname.startsWith('/api/materials/') && req.method === 'PUT') {
    const id = parseInt(pathname.split('/')[3], 10);
    try {
      const b = await parseJsonBody(req);
      const mat = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
      if (!mat) return sendJson(res, 404, { error: 'Material tidak ditemukan' });

      const inToday = b.in_today !== undefined ? parseFloat(b.in_today) : mat.in_today;
      const outToday = b.out_today !== undefined ? parseFloat(b.out_today) : mat.out_today;
      const stockYesterday = b.stock_yesterday !== undefined ? parseFloat(b.stock_yesterday) : mat.stock_yesterday;
      const stockToday = stockYesterday + inToday - outToday;

      db.prepare(`
        UPDATE materials
        SET name = ?, category = ?, unit = ?, stock_yesterday = ?, in_today = ?, out_today = ?, stock_today = ?, min_stock = ?
        WHERE id = ?
      `).run(
        b.name || mat.name,
        b.category || mat.category,
        b.unit || mat.unit,
        stockYesterday,
        inToday,
        outToday,
        stockToday,
        b.min_stock !== undefined ? parseFloat(b.min_stock) : mat.min_stock,
        id
      );

      notifyClients({ type: 'materials_updated' });
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // Rekap Stok Hari Kemarin
  if (pathname === '/api/materials/yesterday' && req.method === 'GET') {
    const todayObj = getWIBDateObj();
    const yesterdayObj = new Date(todayObj.getTime() - 24 * 3600000);
    const yesterdayDate = formatDate(yesterdayObj);
    const todayDate = formatDate(todayObj);

    // Ambil histori yang tersimpan untuk kemarin atau hari ini
    const history = db.prepare(`
      SELECT mh.*, m.name, m.category, m.unit
      FROM material_history mh
      JOIN materials m ON mh.material_id = m.id
      WHERE mh.date = ? OR mh.date = ?
      ORDER BY mh.id DESC
    `).all(yesterdayDate, todayDate);

    const matMap = new Map();
    for (const h of history) {
      if (!matMap.has(h.material_id)) {
        matMap.set(h.material_id, h);
      }
    }

    let items = [];
    if (matMap.size > 0) {
      items = Array.from(matMap.values()).map(h => ({
        id: h.material_id,
        name: h.name,
        category: h.category,
        unit: h.unit,
        stock_yesterday: h.stock_yesterday,
        in_qty: h.in_qty,
        out_qty: h.out_qty,
        stock_final: h.stock_final
      }));
    } else {
      const allMats = db.prepare('SELECT * FROM materials ORDER BY category ASC, name ASC').all();
      items = allMats.map(m => ({
        id: m.id,
        name: m.name,
        category: m.category,
        unit: m.unit,
        stock_yesterday: m.stock_yesterday,
        in_qty: 0,
        out_qty: 0,
        stock_final: m.stock_yesterday
      }));
    }

    return sendJson(res, 200, {
      yesterdayDate,
      items
    });
  }

  if (pathname.startsWith('/api/materials/') && req.method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3], 10);
    db.prepare('DELETE FROM materials WHERE id = ?').run(id);
    notifyClients({ type: 'materials_updated' });
    return sendJson(res, 200, { success: true });
  }

  // 9. Weekly Payroll (MANDOR GABUNG DENGAN ANGGOTANYA DI TABEL BERSAMA)
  if (pathname === '/api/payroll/weekly' && req.method === 'GET') {
    const startDate = urlObj.searchParams.get('startDate');
    const endDate = urlObj.searchParams.get('endDate');

    if (!startDate || !endDate) {
      return sendJson(res, 400, { error: 'startDate dan endDate harus diberikan' });
    }

    const workers = db.prepare(`
      SELECT w.*, m.name as mandor_name 
      FROM workers w
      LEFT JOIN workers m ON w.mandor_id = m.id
      WHERE w.is_archived = 0
      ORDER BY 
        COALESCE(w.mandor_id, w.id) ASC,
        w.is_mandor DESC,
        w.id ASC
    `).all();

    const attendanceRecords = db.prepare(`
      SELECT * FROM attendance_records
      WHERE date >= ? AND date <= ?
    `).all(startDate, endDate);

    const loans = db.prepare('SELECT * FROM worker_loans WHERE remaining_amount > 0').all();

    // Array 7 hari dari startDate s/d endDate
    const days = [];
    let curDate = new Date(startDate + 'T00:00:00');
    const endDateObj = new Date(endDate + 'T00:00:00');
    while (curDate <= endDateObj) {
      const y = curDate.getFullYear();
      const m = String(curDate.getMonth() + 1).padStart(2, '0');
      const d = String(curDate.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      curDate.setDate(curDate.getDate() + 1);
    }

    let totalNetAll = 0;
    let totalGrossAll = 0;
    let totalLoanDeductionAll = 0;

    const payrollList = workers.map(w => {
      const workerAtt = attendanceRecords.filter(a => a.worker_id === w.id);
      let presentDays = 0, halfDays = 0, sickDays = 0, absentDays = 0;
      let totalOvertimeHours = 0, totalSickAllowance = 0, totalExtraDays = 0;
      const dailyStatus = {};

      workerAtt.forEach(a => {
        dailyStatus[a.date] = {
          status: a.status,
          sick_allowance: a.sick_allowance || 0,
          overtime_hours: a.overtime_hours || 0,
          extra_days: a.extra_days || 0,
          job_description: a.job_description || ''
        };

        if (a.status === 'hadir') presentDays += 1;
        else if (a.status === 'setengah_hari') halfDays += 1;
        else if (a.status === 'sakit') {
          sickDays += 1;
          totalSickAllowance += (a.sick_allowance || 0);
        } else if (a.status === 'tidak_hadir') absentDays += 1;

        totalOvertimeHours += (a.overtime_hours || 0);
        totalExtraDays += (a.extra_days || 0);
      });

      const basicDailyWage = w.daily_wage;
      const hourlyOtRate = w.hourly_overtime_rate;

      const baseWage = (presentDays * basicDailyWage) + (halfDays * (basicDailyWage / 2)) + (totalExtraDays * basicDailyWage);
      const overtimeWage = totalOvertimeHours * hourlyOtRate;
      const grossWage = baseWage + overtimeWage + totalSickAllowance;

      const workerLoans = loans.filter(l => l.worker_id === w.id);
      let loanDeductionThisWeek = 0, remainingLoanAfter = 0;

      workerLoans.forEach(l => {
        const deduct = Math.min(l.weekly_term, l.remaining_amount);
        loanDeductionThisWeek += deduct;
        remainingLoanAfter += Math.max(0, l.remaining_amount - deduct);
      });

      const netWage = Math.max(0, grossWage - loanDeductionThisWeek);

      totalNetAll += netWage;
      totalGrossAll += grossWage;
      totalLoanDeductionAll += loanDeductionThisWeek;

      return {
        id: w.id,
        name: w.name,
        specialist: w.specialist,
        is_mandor: w.is_mandor,
        mandor_id: w.mandor_id,
        mandor_name: w.mandor_name,
        daily_wage: w.daily_wage,
        hourly_overtime_rate: w.hourly_overtime_rate,
        dailyStatus,
        presentDays,
        halfDays,
        sickDays,
        absentDays,
        totalOvertimeHours,
        totalExtraDays,
        totalSickAllowance,
        baseWage,
        overtimeWage,
        grossWage,
        loanDeductionThisWeek,
        remainingLoan: remainingLoanAfter,
        remainingLoanAfter,
        netWage
      };
    });

    return sendJson(res, 200, {
      startDate,
      endDate,
      days,
      totalNetAll,
      totalGrossAll,
      totalLoanDeductionAll,
      totalWorkers: workers.length,
      payrollList
    });
  }

  // Riwayat Rekap Upah per Periode (Hanya yang memiliki data kehadiran)
  if (pathname === '/api/payroll/history' && req.method === 'GET') {
    const distinctDates = db.prepare('SELECT DISTINCT date FROM attendance_records ORDER BY date DESC').all();
    const periodMap = new Map();

    distinctDates.forEach(row => {
      const d = new Date(row.date + 'T00:00:00');
      const day = d.getDay(); // 0 = Minggu
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - day);
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);

      const y1 = sunday.getFullYear(), m1 = String(sunday.getMonth()+1).padStart(2,'0'), d1 = String(sunday.getDate()).padStart(2,'0');
      const y2 = saturday.getFullYear(), m2 = String(saturday.getMonth()+1).padStart(2,'0'), d2 = String(saturday.getDate()).padStart(2,'0');
      const startStr = `${y1}-${m1}-${d1}`;
      const endStr = `${y2}-${m2}-${d2}`;
      const key = `${startStr}_${endStr}`;

      if (!periodMap.has(key)) {
        periodMap.set(key, {
          startDate: startStr,
          endDate: endStr,
          recordDates: []
        });
      }
      if (!periodMap.get(key).recordDates.includes(row.date)) {
        periodMap.get(key).recordDates.push(row.date);
      }
    });

    const history = [];

    for (const [key, p] of periodMap.entries()) {
      const recs = db.prepare(`
        SELECT ar.*, w.daily_wage, w.hourly_overtime_rate 
        FROM attendance_records ar
        JOIN workers w ON ar.worker_id = w.id
        WHERE ar.date >= ? AND ar.date <= ?
      `).all(p.startDate, p.endDate);

      if (recs.length === 0) continue;

      const uniqueWorkers = new Set(recs.map(r => r.worker_id));
      let totalNet = 0;

      uniqueWorkers.forEach(wid => {
        const wRecs = recs.filter(r => r.worker_id === wid);
        const wInfo = wRecs[0];
        let present = 0, half = 0, sickAllowance = 0, otHours = 0, extraDays = 0;
        wRecs.forEach(r => {
          if (r.status === 'hadir') present++;
          else if (r.status === 'setengah_hari') half++;
          else if (r.status === 'sakit') sickAllowance += (r.sick_allowance || 0);
          otHours += (r.overtime_hours || 0);
          extraDays += (r.extra_days || 0);
        });
        const baseWage = (present * wInfo.daily_wage) + (half * (wInfo.daily_wage / 2)) + (extraDays * wInfo.daily_wage);
        const otWage = otHours * wInfo.hourly_overtime_rate;
        totalNet += (baseWage + otWage + sickAllowance);
      });

      history.push({
        startDate: p.startDate,
        endDate: p.endDate,
        daysCount: p.recordDates.length,
        workerCount: uniqueWorkers.size,
        totalNetWage: totalNet
      });
    }

    return sendJson(res, 200, history);
  }

  if (pathname === '/api/payroll/reset-week' && req.method === 'POST') {
    try {
      const b = await parseJsonBody(req);
      const correctPin = getSetting('admin_pin', '1234');
      if (b.pin !== correctPin) {
        return sendJson(res, 401, { error: 'PIN Admin tidak valid!' });
      }

      const activeLoans = db.prepare('SELECT * FROM worker_loans WHERE remaining_amount > 0').all();
      const updateLoan = db.prepare('UPDATE worker_loans SET remaining_amount = ? WHERE id = ?');
      
      for (const l of activeLoans) {
        const deduct = Math.min(l.weekly_term, l.remaining_amount);
        const newRem = l.remaining_amount - deduct;
        updateLoan.run(newRem, l.id);
      }

      notifyClients({ type: 'payroll_reset' });
      return sendJson(res, 200, { success: true, message: 'Siklus mingguan berhasil direset.' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Error loading file');
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(`🚀 Aplikasi Absensi Tukang & Stok Material Siap!`);
  console.log(`👉 Akses di Laptop : http://localhost:${PORT}`);
  console.log(`👉 Akses di HP     : http://${localIp}:${PORT}`);
  console.log(`=======================================================`);
});
