const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database('telemetry.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    type TEXT NOT NULL,
    license_plate TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    speed REAL, temperature REAL, battery REAL, fuel REAL,
    lat REAL, lng REAL,
    health_score REAL DEFAULT 100,
    driving_score REAL DEFAULT 100,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    value REAL,
    created_at TEXT DEFAULT (datetime('now')),
    dismissed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS vehicle_stats (
    vehicle_id TEXT PRIMARY KEY,
    total_distance REAL DEFAULT 0,
    last_lat REAL, last_lng REAL
  );
  CREATE TABLE IF NOT EXISTS maintenance (
    vehicle_id TEXT PRIMARY KEY,
    last_service TEXT, next_service TEXT, notes TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS geofences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'authorized',
    center_lat REAL NOT NULL,
    center_lng REAL NOT NULL,
    radius_km REAL DEFAULT 5,
    color TEXT DEFAULT '#3B82F6'
  );
`);

// Safe column additions for upgrades
try { db.exec('ALTER TABLE telemetry ADD COLUMN health_score REAL DEFAULT 100'); } catch (_) { }
try { db.exec('ALTER TABLE telemetry ADD COLUMN driving_score REAL DEFAULT 100'); } catch (_) { }

// ─── Seed Vehicles ────────────────────────────────────────────────────────────
const vehicleCount = db.prepare('SELECT COUNT(*) as count FROM vehicles').get();
if (vehicleCount.count === 0) {
  const seeds = [
    { id: uuidv4(), model: 'Tesla Model S', type: 'Electric', license_plate: 'EV-001-TS' },
    { id: uuidv4(), model: 'Toyota Landcruiser', type: 'SUV', license_plate: 'AP-002-TLC' },
    { id: uuidv4(), model: 'Ford Transit', type: 'Van', license_plate: 'MH-003-FT' },
    { id: uuidv4(), model: 'BMW 5 Series', type: 'Sedan', license_plate: 'KA-004-BMW' },
    { id: uuidv4(), model: 'Mercedes Sprinter', type: 'Truck', license_plate: 'DL-005-MS' },
  ];
  const ins = db.prepare('INSERT INTO vehicles (id, model, type, license_plate) VALUES (?, ?, ?, ?)');
  for (const v of seeds) ins.run(v.id, v.model, v.type, v.license_plate);
}

// Seed maintenance
const maintCount = db.prepare('SELECT COUNT(*) as count FROM maintenance').get();
if (maintCount.count === 0) {
  const vehicles = db.prepare('SELECT id FROM vehicles').all();
  const notes = ['Oil & filter change', 'Full inspection', 'Tire rotation', 'Brake check', 'AC service'];
  vehicles.forEach((v, i) => {
    const last = new Date('2026-02-12'); last.setDate(last.getDate() - i * 7);
    const next = new Date(last); next.setDate(next.getDate() + 60);
    db.prepare('INSERT OR IGNORE INTO maintenance (vehicle_id, last_service, next_service, notes) VALUES (?, ?, ?, ?)')
      .run(v.id, last.toISOString().split('T')[0], next.toISOString().split('T')[0], notes[i] || 'Routine check');
  });
}

// Seed geofences
const geoCount = db.prepare('SELECT COUNT(*) as count FROM geofences').get();
if (geoCount.count === 0) {
  const geos = [
    ['Warehouse Zone', 'authorized', 17.38, 78.48, 3.5, '#22C55E'],
    ['Restricted Zone', 'restricted', 17.42, 78.52, 2.0, '#EF4444'],
    ['Depot Area', 'authorized', 17.355, 78.455, 4.0, '#3B82F6'],
    ['Airport Perimeter', 'restricted', 17.24, 78.43, 3.0, '#F59E0B'],
  ];
  const ins = db.prepare('INSERT INTO geofences (name, type, center_lat, center_lng, radius_km, color) VALUES (?, ?, ?, ?, ?, ?)');
  for (const g of geos) ins.run(...g);
}

// ─── Utility Functions ────────────────────────────────────────────────────────
function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcHealthScore(speed, temp, battery) {
  let s = 100;
  if (speed > 120) s -= 20; else if (speed > 100) s -= 10;
  if (temp > 90) s -= 25; else if (temp > 80) s -= 10;
  if (battery < 15) s -= 20; else if (battery < 30) s -= 10;
  return Math.max(0, s);
}

function healthLabel(s) { return s >= 85 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Fair' : 'Poor'; }
function drivingLabel(s) { return s >= 85 ? 'Safe Driving' : s >= 70 ? 'Moderate' : s >= 50 ? 'Risky' : 'Dangerous'; }

// ─── Per-vehicle in-memory state ──────────────────────────────────────────────
const telemetryState = {};
const gpsState = {};
const drivingState = {};
const idleState = {};
const offlineState = {}; // { isOffline: bool, batched: [], lastSeen: ms }
const anomalyState = {}; // { history: [] } (for temp moving average)

function getOrInitTelemetry(id) {
  if (!telemetryState[id]) telemetryState[id] = { speed: 60 + Math.random() * 40, temperature: 70 + Math.random() * 20, battery: 40 + Math.random() * 50, fuel: 40 + Math.random() * 50, ticksSinceLastSave: 0 };
  return telemetryState[id];
}
function getOrInitGPS(id) {
  if (!gpsState[id]) gpsState[id] = { lat: 17.385 + (Math.random() - .5) * .3, lng: 78.486 + (Math.random() - .5) * .3 };
  return gpsState[id];
}
function getOrInitDriving(id) {
  if (!drivingState[id]) drivingState[id] = { score: 85 + Math.floor(Math.random() * 15), prevSpeed: null, harshBraking: 0, suddenAccel: 0, overspeedEvents: 0 };
  return drivingState[id];
}
function getOrInitIdle(id) {
  if (!idleState[id]) idleState[id] = { ticks: 0 };
  return idleState[id];
}
function getOrInitOffline(id) {
  if (!offlineState[id]) offlineState[id] = { isOffline: false, batched: [], lastSeen: Date.now() };
  return offlineState[id];
}
function getOrInitAnomaly(id) {
  if (!anomalyState[id]) anomalyState[id] = { history: [] }; // keep last 20 temps
  return anomalyState[id];
}

function updateDrivingScore(id, speed) {
  const d = getOrInitDriving(id);
  if (d.prevSpeed !== null) {
    const delta = speed - d.prevSpeed;
    if (delta > 20) { d.suddenAccel++; d.score = clamp(d.score - 3, 0, 100); }
    if (delta < -20) { d.harshBraking++; d.score = clamp(d.score - 5, 0, 100); }
    if (speed > 120) { d.overspeedEvents++; d.score = clamp(d.score - 4, 0, 100); }
    d.score = Math.min(100, d.score + 0.05);
  }
  d.prevSpeed = speed;
  return +d.score.toFixed(1);
}

// ─── Alert Deduplication ──────────────────────────────────────────────────────
const alertCooldowns = {};
function maybeInsertAlert(vehicleId, type, message, value) {
  const key = `${vehicleId}:${type}`;
  const now = Date.now();
  if (alertCooldowns[key] && now - alertCooldowns[key] < 5 * 60 * 1000) return;
  alertCooldowns[key] = now;
  db.prepare('INSERT INTO alerts (vehicle_id, type, message, value) VALUES (?, ?, ?, ?)').run(vehicleId, type, message, value);
}

// ─── Gap Detection & Anomaly ──────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [vid, off] of Object.entries(offlineState)) {
    // 16 seconds gap = ~8 minutes simulated gap
    if (off.isOffline && now - off.lastSeen > 16000) {
      maybeInsertAlert(vid, 'Device Offline', 'Telemetry gap > 8 mins', (now - off.lastSeen) / 1000);
    }
  }
}, 3000);

function checkAnomaly(vid, temp) {
  const st = getOrInitAnomaly(vid);
  if (st.history.length > 10) {
    const avg = st.history.reduce((a, b) => a + b, 0) / st.history.length;
    const variance = st.history.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / st.history.length;
    const stdDev = Math.sqrt(variance);
    // Spike > 3 stddev from normal
    if (stdDev > 1 && Math.abs(temp - avg) > 3 * stdDev) {
      maybeInsertAlert(vid, 'Anomaly Detect', 'ML Model: Unusual Temperature Spike', +temp.toFixed(1));
    }
  }
  st.history.push(temp);
  if (st.history.length > 20) st.history.shift();
}

// ─── Idle & Geofence ──────────────────────────────────────────────────────────
const IDLE_THRESHOLD_TICKS = 10;
function checkIdle(vehicleId, speed) {
  const s = getOrInitIdle(vehicleId);
  if (speed < 3) {
    s.ticks++;
    if (s.ticks === IDLE_THRESHOLD_TICKS) {
      maybeInsertAlert(vehicleId, 'Idle Detection', `Vehicle idle (engine on, speed ≈ 0)`, s.ticks * 2);
    }
  } else { s.ticks = 0; }
}

function checkGeofences(vehicleId, lat, lng) {
  const zones = db.prepare('SELECT * FROM geofences').all();
  for (const z of zones) {
    const dist = haversine(lat, lng, z.center_lat, z.center_lng);
    if (z.type === 'restricted' && dist < z.radius_km) {
      maybeInsertAlert(vehicleId, 'Geofence Breach', `Entered restricted zone: ${z.name}`, +dist.toFixed(3));
    }
  }
}

// ─── Smart Compression DB Hook ────────────────────────────────────────────────
const insertTelemetry = db.prepare('INSERT INTO telemetry (vehicle_id, speed, temperature, battery, fuel, lat, lng, health_score, driving_score, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const upsertStats = db.prepare('INSERT INTO vehicle_stats (vehicle_id, total_distance, last_lat, last_lng) VALUES (?, ?, ?, ?) ON CONFLICT(vehicle_id) DO UPDATE SET total_distance=total_distance+excluded.total_distance, last_lat=excluded.last_lat, last_lng=excluded.last_lng');

const lastSaved = {};
function smartCompressAndSave(vId, s, gps, hs, ds, ts) {
  const last = lastSaved[vId];
  getOrInitTelemetry(vId).ticksSinceLastSave++;
  const forceKeyframe = getOrInitTelemetry(vId).ticksSinceLastSave > 10;

  let shouldSave = forceKeyframe || !last;
  if (last && !forceKeyframe) {
    if (Math.abs(s.speed - last.speed) > 0.5 ||
      Math.abs(s.temperature - last.temp) > 0.5 ||
      Math.abs(s.battery - last.bat) > 0.5) {
      shouldSave = true;
    }
  }

  if (shouldSave) {
    insertTelemetry.run(vId, +s.speed.toFixed(1), +s.temperature.toFixed(1),
      +s.battery.toFixed(1), +s.fuel.toFixed(1),
      +gps.lat.toFixed(6), +gps.lng.toFixed(6),
      +hs.toFixed(1), +ds.toFixed(1), ts || new Date().toISOString());
    lastSaved[vId] = { speed: s.speed, temp: s.temperature, bat: s.battery };
    getOrInitTelemetry(vId).ticksSinceLastSave = 0;
  }
}

// ─── Telemetry Simulator ──────────────────────────────────────────────────────
function getStatus(speed, temp, battery) {
  if (speed > 130 || temp > 100 || battery < 15) return 'Critical';
  if (speed > 100 || temp > 85 || battery < 30) return 'Warning';
  return 'Normal';
}

function simulateTick() {
  const vehicles = db.prepare('SELECT id FROM vehicles').all();
  const updates = [];
  const edgeEvents = [];
  const onlineSyncEvents = [];

  for (const v of vehicles) {
    const s = getOrInitTelemetry(v.id);
    const gps = getOrInitGPS(v.id);
    const prevLat = gps.lat, prevLng = gps.lng;
    const off = getOrInitOffline(v.id);

    // Network Drop logic (5% chance to flip state)
    if (Math.random() < 0.05) off.isOffline = !off.isOffline;

    // Simulate physics
    const accel = (Math.random() - .5) * 12;
    s.speed = clamp(s.speed + accel, 0, 160);

    // Simulate rare temp anomaly (1% chance)
    if (Math.random() < 0.01) s.temperature += 15;
    else s.temperature = clamp(s.temperature + (Math.random() - .5) * 3, 50, 115);

    s.battery = clamp(s.battery - Math.random() * .3, 5, 100);
    s.fuel = clamp(s.fuel - Math.random() * .2, 5, 100);
    gps.lat += (Math.random() - .5) * .002;
    gps.lng += (Math.random() - .5) * .002;

    const healthScore = calcHealthScore(s.speed, s.temperature, s.battery);
    const drivingScore = updateDrivingScore(v.id, s.speed);
    const dist = haversine(prevLat, prevLng, gps.lat, gps.lng);
    const ts = new Date().toISOString();

    upsertStats.run(v.id, +dist.toFixed(4), +gps.lat.toFixed(6), +gps.lng.toFixed(6));

    const point = {
      vehicleId: v.id, speed: +s.speed.toFixed(1), temperature: +s.temperature.toFixed(1),
      battery: +s.battery.toFixed(1), fuel: +s.fuel.toFixed(1),
      lat: +gps.lat.toFixed(6), lng: +gps.lng.toFixed(6),
      healthScore: +healthScore.toFixed(1), healthLabel: healthLabel(healthScore),
      drivingScore: +drivingScore.toFixed(1), drivingLabel: drivingLabel(drivingScore),
      idleTicks: idleState[v.id]?.ticks || 0,
      status: getStatus(s.speed, s.temperature, s.battery),
      timestamp: ts, expectedOffline: off.isOffline
    };

    if (off.isOffline) {
      // Offline Batching
      off.batched.push(point);
    } else {
      // Reconnected & Syncing
      if (off.batched.length > 0) {
        off.batched.forEach(b => smartCompressAndSave(v.id, b, b, b.healthScore, b.drivingScore, b.timestamp));
        onlineSyncEvents.push({ vehicleId: v.id, count: off.batched.length });
        off.batched = [];
      }
      off.lastSeen = Date.now();
      smartCompressAndSave(v.id, s, gps, healthScore, drivingScore, ts);
      updates.push(point);

      // Edge Event Processing Simulation
      // The vehicle LOCALLY detected an event and pushed it (avoiding raw server poll loop)
      if (s.speed > 120) {
        edgeEvents.push({ vehicleId: v.id, type: 'Overspeed', val: +s.speed.toFixed(1) });
      }
      if (s.battery < 15) {
        edgeEvents.push({ vehicleId: v.id, type: 'Low Battery', val: +s.battery.toFixed(1) });
      }

      // Anomaly Check (Self-learning)
      checkAnomaly(v.id, s.temperature);

      // System Alerts
      checkIdle(v.id, s.speed);
      checkGeofences(v.id, gps.lat, gps.lng);
    }
  }

  // Handle Edge Events
  edgeEvents.forEach(e => maybeInsertAlert(e.vehicleId, `Edge Event: ${e.type}`, `Pre-processed on vehicle edge: ${e.type}`, e.val));

  const alertCount = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE dismissed=0').get().count;
  const payload = JSON.stringify({ type: 'telemetry_update', data: updates, alertCount, syncEvents: onlineSyncEvents });
  for (const c of wss.clients) { if (c.readyState === WebSocket.OPEN) c.send(payload); }
}

setInterval(simulateTick, 2000);

// ─── REST API ─────────────────────────────────────────────────────────────────

app.post('/api/vehicles', (req, res) => {
  const { model, type, license_plate } = req.body;
  if (!model || !type || !license_plate) return res.status(400).json({ error: 'Missing fields' });
  const id = uuidv4();
  db.prepare('INSERT INTO vehicles (id, model, type, license_plate) VALUES (?, ?, ?, ?)').run(id, model, type, license_plate);
  const next = new Date(); next.setDate(next.getDate() + 60);
  db.prepare('INSERT OR IGNORE INTO maintenance (vehicle_id, last_service, next_service, notes) VALUES (?, ?, ?, ?)').run(id, new Date().toISOString().split('T')[0], next.toISOString().split('T')[0], 'Initial registration');
  res.status(201).json({ id, model, type, license_plate });
});

app.get('/api/vehicles', (req, res) => {
  const vehicles = db.prepare('SELECT * FROM vehicles ORDER BY created_at DESC').all();
  res.json(vehicles.map(v => {
    const latest = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT 1').get(v.id);
    const stats = db.prepare('SELECT * FROM vehicle_stats WHERE vehicle_id=?').get(v.id);
    return { ...v, latest: latest || null, status: latest ? getStatus(latest.speed, latest.temperature, latest.battery) : 'Normal', totalDistance: +(stats?.total_distance || 0).toFixed(2) };
  }));
});

app.delete('/api/vehicles/:id', (req, res) => {
  ['telemetry', 'alerts', 'vehicle_stats', 'maintenance'].forEach(t => db.prepare(`DELETE FROM ${t} WHERE vehicle_id=?`).run(req.params.id));
  db.prepare('DELETE FROM vehicles WHERE id=?').run(req.params.id);
  ['telemetryState', 'gpsState', 'drivingState', 'idleState', 'offlineState', 'anomalyState'].forEach(k => delete eval(k)[req.params.id]);
  res.json({ success: true });
});

app.get('/api/telemetry/:vehicleId', (req, res) => {
  const limit = parseInt(req.query.limit) || 60;
  const rows = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT ?').all(req.params.vehicleId, limit);
  res.json(rows.reverse());
});

app.get('/api/stats', (req, res) => {
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  let normal = 0, warning = 0, critical = 0, active = 0, totalSpeed = 0, totalBattery = 0, totalDist = 0, count = 0;
  for (const v of vehicles) {
    const l = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT 1').get(v.id);
    const s = db.prepare('SELECT * FROM vehicle_stats WHERE vehicle_id=?').get(v.id);
    totalDist += s?.total_distance || 0;
    if (l) {
      // Only active if not simulated offline
      if (!offlineState[v.id]?.isOffline) active++;
      count++; totalSpeed += l.speed; totalBattery += l.battery;
      const st = getStatus(l.speed, l.temperature, l.battery);
      if (st === 'Normal') normal++; else if (st === 'Warning') warning++; else critical++;
    }
  }
  const alertCount = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE dismissed=0').get().count;
  res.json({
    total: vehicles.length, active, normal, warning, critical, alertCount,
    avgSpeed: count ? +(totalSpeed / count).toFixed(1) : 0, avgBattery: count ? +(totalBattery / count).toFixed(1) : 0,
    totalDistance: +totalDist.toFixed(2), activePercent: vehicles.length ? +((active / vehicles.length) * 100).toFixed(1) : 0
  });
});

app.get('/api/fleet-stats', (req, res) => {
  const vehicles = db.prepare('SELECT id FROM vehicles').all();
  let tSpeed = 0, tBattery = 0, tTemp = 0, tDist = 0, tHealth = 0, tDriving = 0, count = 0;
  for (const v of vehicles) {
    const l = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT 1').get(v.id);
    const s = db.prepare('SELECT * FROM vehicle_stats WHERE vehicle_id=?').get(v.id);
    tDist += s?.total_distance || 0;
    if (l) {
      count++; tSpeed += l.speed; tBattery += l.battery; tTemp += l.temperature;
      tHealth += l.health_score || calcHealthScore(l.speed, l.temperature, l.battery);
      tDriving += l.driving_score || 90;
    }
  }
  const avgHealth = count ? +(tHealth / count).toFixed(1) : 0;
  const avgEnergy = count ? +(tBattery / count).toFixed(1) : 0;
  const uptime = vehicles.length ? +((count / vehicles.length) * 100).toFixed(1) : 0; // approximate
  const efficiency = +((avgHealth + avgEnergy + uptime) / 3).toFixed(1);
  res.json({
    efficiency, avgHealth, avgEnergy, uptime,
    avgSpeed: count ? +(tSpeed / count).toFixed(1) : 0,
    avgBattery: avgEnergy,
    avgTemperature: count ? +(tTemp / count).toFixed(1) : 0,
    avgDrivingScore: count ? +(tDriving / count).toFixed(1) : 0,
    totalDistance: +tDist.toFixed(2),
    activeVehicles: count, totalVehicles: vehicles.length, activePercent: uptime,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const vehicles = db.prepare('SELECT * FROM vehicles').all();
  const ranked = vehicles.map(v => {
    const l = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT 1').get(v.id);
    if (!l) return null;
    const health = l.health_score || calcHealthScore(l.speed, l.temperature, l.battery);
    const energy = l.battery;
    const driving = drivingState[v.id]?.score || l.driving_score || 90;
    const efficiency = +((health + energy + driving) / 3).toFixed(1);
    return {
      id: v.id, model: v.model, type: v.type, license_plate: v.license_plate,
      health: +health.toFixed(1), energy: +energy.toFixed(1), driving: +driving.toFixed(1),
      efficiency, status: getStatus(l.speed, l.temperature, l.battery)
    };
  }).filter(Boolean);
  ranked.sort((a, b) => b.efficiency - a.efficiency);
  ranked.forEach((v, i) => v.rank = i + 1);
  res.json(ranked);
});

app.get('/api/predictions/:vehicleId', (req, res) => {
  const rows = db.prepare('SELECT * FROM telemetry WHERE vehicle_id=? ORDER BY id DESC LIMIT 30').all(req.params.vehicleId);
  if (!rows.length) return res.json([]);
  let harshBraking = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].speed - rows[i - 1].speed > 15) harshBraking++;
  const batDecline = (rows[rows.length - 1]?.battery || 0) - (rows[0]?.battery || 0);
  const highTempCount = rows.filter(r => r.temperature > 80).length;
  const d = drivingState[req.params.vehicleId];
  const totalHarsh = (d?.harshBraking || 0) + harshBraking;
  const avgTemp = rows.reduce((s, r) => s + r.temperature, 0) / rows.length;
  const tempVariance = rows.reduce((s, r) => s + Math.pow(r.temperature - avgTemp, 2), 0) / rows.length;
  const tempStdDev = Math.sqrt(tempVariance);

  const predictions = [
    { type: 'Brake Wear', icon: '🛑', risk: totalHarsh > 5 ? 'HIGH' : totalHarsh > 2 ? 'MEDIUM' : 'LOW', detail: totalHarsh > 5 ? `Suggested service in ${Math.max(1, 7 - totalHarsh)} days` : 'Normal wear', metric: `${totalHarsh} harsh braking events` },
    { type: 'Battery Health', icon: '🔋', risk: batDecline > 10 ? 'HIGH' : batDecline > 5 ? 'MEDIUM' : 'LOW', detail: batDecline > 10 ? 'Battery degrading — schedule replacement' : 'Battery is healthy', metric: `${batDecline.toFixed(1)}% drop in last 30 intervals` },
    { type: 'Temperature Range', icon: '🌡️', risk: tempStdDev > 5 ? 'HIGH' : tempStdDev > 2 ? 'MEDIUM' : 'LOW', detail: tempStdDev > 5 ? 'High thermal variance detected' : 'Stable temperature range', metric: `StdDev: ${tempStdDev.toFixed(2)}°C` },
  ];
  res.json(predictions);
});

app.get('/api/driving/:vehicleId', (req, res) => {
  const d = drivingState[req.params.vehicleId];
  if (!d) return res.json({ score: 90, label: 'Safe Driving', harshBraking: 0, suddenAccel: 0, overspeedEvents: 0 });
  res.json({ score: +d.score.toFixed(1), label: drivingLabel(d.score), harshBraking: d.harshBraking, suddenAccel: d.suddenAccel, overspeedEvents: d.overspeedEvents });
});

app.get('/api/alerts', (req, res) => res.json(db.prepare('SELECT a.*, v.model, v.license_plate FROM alerts a JOIN vehicles v ON v.id=a.vehicle_id WHERE a.dismissed=0 ORDER BY a.id DESC LIMIT 100').all()));
app.post('/api/alerts/:id/dismiss', (req, res) => { db.prepare('UPDATE alerts SET dismissed=1 WHERE id=?').run(req.params.id); res.json({ success: true }); });
app.post('/api/alerts/dismiss-all', (req, res) => { db.prepare('UPDATE alerts SET dismissed=1').run(); res.json({ success: true }); });

app.get('/api/maintenance', (req, res) => res.json(db.prepare('SELECT m.*, v.model, v.license_plate, v.type FROM maintenance m JOIN vehicles v ON v.id=m.vehicle_id ORDER BY m.next_service ASC').all()));
app.get('/api/maintenance/:vehicleId', (req, res) => res.json(db.prepare('SELECT m.*, v.model, v.license_plate FROM maintenance m JOIN vehicles v ON v.id=m.vehicle_id WHERE m.vehicle_id=?').get(req.params.vehicleId) || null));
app.put('/api/maintenance/:vehicleId', (req, res) => {
  const { last_service, next_service, notes } = req.body;
  db.prepare("INSERT INTO maintenance (vehicle_id, last_service, next_service, notes) VALUES (?, ?, ?, ?) ON CONFLICT(vehicle_id) DO UPDATE SET last_service=excluded.last_service, next_service=excluded.next_service, notes=excluded.notes, updated_at=datetime('now')").run(req.params.vehicleId, last_service, next_service, notes);
  res.json({ success: true });
});

app.get('/api/geofences', (req, res) => res.json(db.prepare('SELECT * FROM geofences ORDER BY id').all()));
app.post('/api/geofences', (req, res) => {
  const { name, type, center_lat, center_lng, radius_km, color } = req.body;
  const result = db.prepare('INSERT INTO geofences (name, type, center_lat, center_lng, radius_km, color) VALUES (?, ?, ?, ?, ?, ?)').run(name, type || 'authorized', center_lat, center_lng, radius_km || 5, color || '#3B82F6');
  res.status(201).json({ id: result.lastInsertRowid, name, type, center_lat, center_lng, radius_km, color });
});
app.delete('/api/geofences/:id', (req, res) => { db.prepare('DELETE FROM geofences WHERE id=?').run(req.params.id); res.json({ success: true }); });

app.get('/api/telemetry/:vehicleId/replay', (req, res) => res.json(db.prepare('SELECT id, speed, temperature, battery, lat, lng, health_score, driving_score, timestamp FROM telemetry WHERE vehicle_id=? ORDER BY id ASC LIMIT 200').all(req.params.vehicleId)));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚗 Telemetry server (Hackathon Winner) running at http://localhost:${PORT}`));
