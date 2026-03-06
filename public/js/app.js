/* ────────────────────────────────────────────────────────────────────────────
   FleetTrack — app.js  (Intermediate Features Edition)
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    vehicles: [],
    telemetryHistory: {},
    currentPage: 'dashboard',
    analyticsVehicleId: null,
    detailVehicleId: null,
    mapMarkers: {},
    dashCharts: {},
    analyticsCharts: {},
    detailCharts: {},
    ws: null,
    currentFilter: 'all',
    alerts: [],
    fleetStats: {},
};

// ─── Routing ──────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
    dashboard: 'Dashboard', vehicles: 'Vehicles', alerts: 'Alerts',
    map: 'Live Map', analytics: 'Analytics', maintenance: 'Maintenance', vehicledetail: 'Vehicle Detail'
};

function navigate(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Highlight nav (vehicledetail shares no nav)
    const navEl = document.getElementById(`nav-${page}`);
    if (navEl) navEl.classList.add('active');

    document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
    state.currentPage = page;

    if (page === 'dashboard') { setTimeout(initDashCharts, 80); updateDashboardStats(); updateFleetStats(); }
    if (page === 'map') { setTimeout(initMap, 80); }
    if (page === 'analytics') { populateAnalyticsSelect(); setTimeout(initAnalyticsCharts, 80); }
    if (page === 'alerts') { renderAlerts(); }
    if (page === 'maintenance') { renderMaintenance(); }
    if (page === 'vehicledetail' && state.detailVehicleId) { renderVehicleDetail(state.detailVehicleId); }
}

window.addEventListener('hashchange', () => {
    const hash = location.hash.replace('#', '') || 'dashboard';
    // Support #vehicle/ID
    if (hash.startsWith('vehicle/')) {
        state.detailVehicleId = hash.split('/')[1];
        navigate('vehicledetail');
    } else {
        navigate(hash);
    }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${proto}://${location.host}`);
    state.ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'telemetry_update') handleTelemetryUpdate(msg.data, msg.alertCount, msg.syncEvents);
    };
    state.ws.onclose = () => setTimeout(connectWS, 3000);
    state.ws.onerror = () => state.ws.close();
}

function handleTelemetryUpdate(updates, alertCount, syncEvents) {
    updates.forEach(u => {
        const v = state.vehicles.find(vv => vv.id === u.vehicleId);
        if (v) { v.latest = u; v.status = u.status; v.healthScore = u.healthScore; v.drivingScore = u.drivingScore; }
        if (!state.telemetryHistory[u.vehicleId]) state.telemetryHistory[u.vehicleId] = [];
        state.telemetryHistory[u.vehicleId].push(u);
        if (state.telemetryHistory[u.vehicleId].length > 60) state.telemetryHistory[u.vehicleId].shift();
    });

    // Update alert badge
    updateAlertBadge(alertCount || 0);

    if (state.currentPage === 'dashboard') { updateDashboardStats(); updateDashboardFleetList(); updateDashCharts(); }
    if (state.currentPage === 'vehicles') { updateVehicleCards(); }
    if (state.currentPage === 'map') { updateMapMarkers(); }
    if (state.currentPage === 'analytics') { updateAnalyticsCharts(); }
    if (state.currentPage === 'vehicledetail') {
        updateDetailCharts();
        const u = updates.find(x => x.vehicleId === state.detailVehicleId);
        if (u) updateDigitalTwin(u);
    }

    document.getElementById('vehicleCountBadge').textContent = state.vehicles.length;

    // Handle offline sync toasts
    if (syncEvents && syncEvents.length) {
        syncEvents.forEach(se => {
            const v = state.vehicles.find(vv => vv.id === se.vehicleId);
            if (v) showToast(`Sync: ${v.license_plate} back online (${se.count} events batched)`);
        });
    }
}

// ─── Digital Twin ────────────────────────────────────────────────────────────
function updateDigitalTwin(telemetryData) {
    const batEl = document.getElementById('dtBatteryHealth');
    const engEl = document.getElementById('dtEngineStatus');
    const pill = document.getElementById('dtSyncPill');
    const carEl = document.getElementById('dtCar');

    if (!carEl) return;

    if (telemetryData.expectedOffline) {
        pill.style.display = 'block';
        carEl.classList.remove('dt-driving', 'dt-running');
        engEl.textContent = 'OFFLINE';
        return;
    }
    pill.style.display = 'none';

    // Battery String
    if (telemetryData.battery < 15) { batEl.textContent = 'CRITICAL'; batEl.style.color = 'var(--danger)'; }
    else if (telemetryData.battery < 30) { batEl.textContent = 'LOW'; batEl.style.color = 'var(--warning)'; }
    else { batEl.textContent = 'GOOD'; batEl.style.color = 'var(--success)'; }

    // Engine/Speed
    carEl.classList.remove('dt-health-good', 'dt-health-warn', 'dt-health-crit');
    if (telemetryData.healthScore >= 85) carEl.classList.add('dt-health-good');
    else if (telemetryData.healthScore >= 60) carEl.classList.add('dt-health-warn');
    else carEl.classList.add('dt-health-crit');

    if (telemetryData.speed > 5) {
        carEl.classList.add('dt-driving', 'dt-running');
        engEl.textContent = 'RUNNING';
        engEl.style.color = 'var(--success)';
    } else {
        carEl.classList.remove('dt-driving');
        carEl.classList.add('dt-running'); // engine idle
        engEl.textContent = 'IDLE';
        engEl.style.color = 'var(--warning)';
    }
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(url) { const r = await fetch(url); return r.json(); }
async function apiPost(url, body = {}) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
async function apiPut(url, body = {}) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
async function apiDelete(url) { await fetch(url, { method: 'DELETE' }); }

async function fetchVehicles() {
    state.vehicles = await apiFetch('/api/vehicles');
    state.vehicles.forEach(v => {
        if (!state.telemetryHistory[v.id]) state.telemetryHistory[v.id] = [];
        if (v.latest) state.telemetryHistory[v.id].push(v.latest);
    });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function updateDashboardStats() {
    const s = await apiFetch('/api/stats');
    setText('statTotal', s.total);
    setText('statActive', s.active);
    setText('statWarning', s.warning);
    setText('statCritical', s.critical);
    updateAlertBadge(s.alertCount || 0);
}

async function updateFleetStats() {
    const s = await apiFetch('/api/fleet-stats');
    state.fleetStats = s;
    setText('fsAvgSpeed', s.avgSpeed);
    setText('fsTotalDist', s.totalDistance);
    setText('fsAvgBattery', s.avgBattery);
    setText('fsActivePercent', s.activePercent);
    setText('fsAvgHealth', s.avgHealthScore);
}

function updateDashboardFleetList() {
    const el = document.getElementById('dashboardFleetList');
    const sorted = [...state.vehicles].sort((a, b) => {
        const o = { Critical: 0, Warning: 1, Normal: 2 };
        return (o[a.status] ?? 3) - (o[b.status] ?? 3);
    });
    el.innerHTML = sorted.slice(0, 6).map(v => `
    <div class="fleet-list-item" onclick="openVehicleDetail('${v.id}')">
      <div class="fleet-list-item-icon">🚗</div>
      <div class="fleet-list-item-info">
        <div class="fleet-list-item-name">${escHtml(v.model)}</div>
        <div class="fleet-list-item-sub">${escHtml(v.type)} · ${v.latest ? v.latest.speed + ' km/h' : 'No data'}</div>
      </div>
      <span class="status-badge status-badge--${v.status}">${v.status}</span>
    </div>`).join('');

    updateLeaderboard();
}

async function updateLeaderboard() {
    const el = document.getElementById('dashboardLeaderboard');
    if (!el) return;
    try {
        const lb = await apiFetch('/api/leaderboard');
        if (!lb.length) { el.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:20px;text-align:center">No data yet</div>'; return; }
        el.innerHTML = lb.slice(0, 5).map(v => `
        <div class="lb-item" onclick="openVehicleDetail('${v.id}')">
            <div class="lb-rank lb-rank--${v.rank}">${v.rank}</div>
            <div class="lb-info">
                <div class="lb-name">${escHtml(v.model)}</div>
                <div class="lb-plate">${escHtml(v.license_plate)}</div>
            </div>
            <div class="lb-score-wrap">
                <div class="lb-score">${v.efficiency}%</div>
                <div class="lb-score-lbl">Efficiency</div>
            </div>
        </div>`).join('');
    } catch (e) { console.error('Leaderboard error', e); }
}

// ─── Dashboard Charts ─────────────────────────────────────────────────────────
function initDashCharts() {
    const mkLine = (label, color, fill = false) => ({
        type: 'line', data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: fill ? color + '20' : 'transparent', borderWidth: 2, pointRadius: 2, tension: 0.4, fill }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 } } } }, animation: { duration: 300 } }
    });
    const s = document.getElementById('dashSpeedChart')?.getContext('2d');
    const t = document.getElementById('dashTempChart')?.getContext('2d');
    const b = document.getElementById('dashBatteryChart')?.getContext('2d');
    if (s && !state.dashCharts.speed) {
        state.dashCharts.speed = new Chart(s, mkLine('km/h', '#3B82F6'));
        state.dashCharts.temp = new Chart(t, mkLine('°C', '#F59E0B'));
        state.dashCharts.battery = new Chart(b, mkLine('%', '#22C55E', true));
    }
    updateDashCharts();
}

function updateDashCharts() {
    if (!state.dashCharts.speed) return;
    const max = 30;
    const sums = { speed: new Array(max).fill(0), temp: new Array(max).fill(0), bat: new Array(max).fill(0) };
    const counts = new Array(max).fill(0);
    Object.values(state.telemetryHistory).forEach(hist => {
        hist.slice(-max).forEach((h, i) => { sums.speed[i] += h.speed; sums.temp[i] += h.temperature; sums.bat[i] += h.battery; counts[i]++; });
    });
    const labels = counts.map((_, i) => i);
    setChartData(state.dashCharts.speed, labels, sums.speed.map((s, i) => counts[i] ? +(s / counts[i]).toFixed(1) : null));
    setChartData(state.dashCharts.temp, labels, sums.temp.map((s, i) => counts[i] ? +(s / counts[i]).toFixed(1) : null));
    setChartData(state.dashCharts.battery, labels, sums.bat.map((s, i) => counts[i] ? +(s / counts[i]).toFixed(1) : null));
}

function setChartData(chart, labels, data) { chart.data.labels = labels; chart.data.datasets[0].data = data; chart.update('none'); }

// ─── Vehicles Page ────────────────────────────────────────────────────────────
function updateVehicleCards() {
    const grid = document.getElementById('vehiclesGrid');
    const search = (document.getElementById('vehicleSearch')?.value || '').toLowerCase();
    const filter = state.currentFilter;
    if (!grid) return;
    const filtered = state.vehicles.filter(v => {
        const m = v.model.toLowerCase().includes(search) || v.license_plate.toLowerCase().includes(search);
        return m && (filter === 'all' || v.status === filter);
    });
    grid.innerHTML = filtered.map(vehicleCardHTML).join('');
    grid.querySelectorAll('[data-delete-id]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = btn.dataset.deleteId;
            if (confirm('Remove this vehicle?')) {
                await apiDelete(`/api/vehicles/${id}`);
                state.vehicles = state.vehicles.filter(v => v.id !== id);
                delete state.telemetryHistory[id];
                updateVehicleCards();
                showToast('Vehicle removed');
            }
        });
    });
    grid.querySelectorAll('[data-detail-id]').forEach(card => {
        card.addEventListener('click', () => openVehicleDetail(card.dataset.detailId));
    });
}

function vehicleCardHTML(v) {
    const lat = v.latest;
    const speed = lat ? lat.speed.toFixed(1) : '—';
    const temp = lat ? lat.temperature.toFixed(1) : '—';
    const bat = lat ? lat.battery.toFixed(1) : '—';
    const batN = lat ? parseFloat(lat.battery) : 0;
    const batCl = batN >= 50 ? 'high' : batN >= 25 ? 'medium' : 'low';
    const ts = lat ? formatTime(lat.timestamp) : 'No data';
    const hs = v.latest?.healthScore ?? v.healthScore ?? 100;
    const ds = v.latest?.drivingScore ?? v.drivingScore ?? 90;
    const hl = healthLabel(hs);
    const dl = drivingLabel(ds);
    return `
    <div class="vehicle-card status--${v.status}" data-detail-id="${v.id}">
      <div class="vcard-header">
        <div><div class="vcard-title">${escHtml(v.model)}</div><div class="vcard-sub">${escHtml(v.type)}</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="status-badge status-badge--${v.status}">${v.status}</span>
          <button class="vcard-delete" data-delete-id="${v.id}" title="Remove">✕</button>
        </div>
      </div>
      <div class="vcard-metrics">
        <div class="vcard-metric">
          <div class="vcard-metric-label">Speed</div>
          <div class="vcard-metric-value">${speed}</div>
          <div class="vcard-metric-unit">km/h</div>
        </div>
        <div class="vcard-metric">
          <div class="vcard-metric-label">Temp</div>
          <div class="vcard-metric-value">${temp}</div>
          <div class="vcard-metric-unit">°C</div>
        </div>
        <div class="vcard-metric">
          <div class="vcard-metric-label">Battery</div>
          <div class="vcard-metric-value">${bat}</div>
          <div class="vcard-metric-unit">%</div>
          <div class="battery-bar-wrap"><div class="battery-bar"><div class="battery-bar-fill ${batCl}" style="width:${Math.min(100, batN)}%"></div></div></div>
        </div>
      </div>
      <div class="vcard-scores">
        <div class="score-pill score-pill--health">
          <div><div class="score-pill-label">Health</div><div class="score-pill-sub">${hl}</div></div>
          <div class="score-pill-value">${hs}</div>
        </div>
        <div class="score-pill score-pill--driving">
          <div><div class="score-pill-label">Driver</div><div class="score-pill-sub">${dl}</div></div>
          <div class="score-pill-value">${ds}</div>
        </div>
      </div>
      <div class="vcard-footer">
        <span class="vcard-plate">${escHtml(v.license_plate)}</span>
        <span class="vcard-time">Updated ${ts}</span>
      </div>
    </div>`;
}

// ─── Vehicle Detail Page ──────────────────────────────────────────────────────
function openVehicleDetail(vehicleId) {
    state.detailVehicleId = vehicleId;
    location.hash = `#vehicle/${vehicleId}`;
}

async function renderVehicleDetail(vehicleId) {
    const v = state.vehicles.find(vv => vv.id === vehicleId);
    if (!v) return;

    // Fetch history + driving data in parallel
    const [hist, driving, maint, predictions] = await Promise.all([
        apiFetch(`/api/telemetry/${vehicleId}`),
        apiFetch(`/api/driving/${vehicleId}`),
        apiFetch(`/api/maintenance/${vehicleId}`).catch(() => null),
        apiFetch(`/api/predictions/${vehicleId}`).catch(() => []),
    ]);
    state.telemetryHistory[vehicleId] = hist;
    const lat = v.latest || hist[hist.length - 1] || {};

    // Header
    const hs = lat.health_score ?? lat.healthScore ?? 100;
    const ds = driving.score || 90;
    document.getElementById('detailPageTitle').textContent = v.model;
    document.getElementById('detailPageSub').textContent = `${v.type} · ${v.license_plate} · ${v.status}`;
    document.getElementById('detailPageScores').innerHTML = `
    <div class="score-badge score-badge--health">
      <span class="score-badge-num">${hs}</span>
      <span class="score-badge-label">Health</span>
    </div>
    <div class="score-badge score-badge--driving">
      <span class="score-badge-num">${ds}</span>
      <span class="score-badge-label">Driver Score</span>
    </div>`;

    // Live metrics
    document.getElementById('detailLiveMetrics').innerHTML = [
        { label: 'Speed', value: lat.speed ?? '—', unit: 'km/h' },
        { label: 'Temperature', value: lat.temperature ?? '—', unit: '°C' },
        { label: 'Battery', value: lat.battery ?? '—', unit: '%' },
        { label: 'Fuel', value: lat.fuel ?? '—', unit: '%' },
        { label: 'Latitude', value: lat.lat ?? '—', unit: '' },
        { label: 'Longitude', value: lat.lng ?? '—', unit: '' },
    ].map(m => `
    <div class="detail-metric-box">
      <div class="dmb-label">${m.label}</div>
      <div class="dmb-value">${m.value}</div>
      <div class="dmb-unit">${m.unit}</div>
    </div>`).join('');

    // Driving behaviour card
    document.getElementById('detailDrivingCard').innerHTML = `
    <div class="card-header"><h2 class="card-title">Driving Behaviour</h2></div>
    <div class="driving-score-header">
      <div><div class="driving-score-big">${ds} <span style="font-size:14px;color:var(--gray-400)">/ 100</span></div></div>
      <span class="status-badge status-badge--${ds >= 85 ? 'Normal' : ds >= 60 ? 'Warning' : 'Critical'}">${driving.label}</span>
    </div>
    <div class="driving-events">
      <div class="driving-event-row"><span class="driving-event-label">🛑 Harsh Braking</span><span class="driving-event-count">${driving.harshBraking}</span></div>
      <div class="driving-event-row"><span class="driving-event-label">⚡ Sudden Acceleration</span><span class="driving-event-count">${driving.suddenAccel}</span></div>
      <div class="driving-event-row"><span class="driving-event-label">🚨 Overspeed Events</span><span class="driving-event-count">${driving.overspeedEvents}</span></div>
    </div>
    ${maint ? `
    <div style="margin-top:14px;border-top:1px solid var(--gray-100);padding-top:12px">
      <div class="card-header" style="margin-bottom:8px"><h2 class="card-title">🔧 Maintenance</h2></div>
      <div class="maint-rows">
        <div class="maint-row"><span class="maint-row-label">Last Service</span><span class="maint-row-value">${maint.last_service || '—'}</span></div>
        <div class="maint-row"><span class="maint-row-label">Next Service</span><span class="maint-row-value ${maintClass(maint.next_service)}">${maint.next_service || '—'}</span></div>
        <div class="maint-row"><span class="maint-row-label">Notes</span><span class="maint-row-value" style="font-size:12px">${escHtml(maint.notes || '—')}</span></div>
      </div>
    </div>` : ''}`;

    // Predictive Maintenance
    const predEl = document.getElementById('detailPredictiveList');
    if (predictions && predictions.length) {
        predEl.innerHTML = predictions.map(p => `
        <div class="pred-card">
            <div class="pred-icon">${p.icon}</div>
            <div class="pred-body">
                <div class="pred-header">
                    <span class="pred-type">${p.type}</span>
                    <span class="pred-risk pred-risk--${p.risk}">${p.risk}</span>
                </div>
                <div class="pred-detail">${p.detail}</div>
                <div class="pred-metric">${p.metric}</div>
            </div>
        </div>`).join('');
    } else {
        predEl.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:20px 0">Not enough data for AI prediction</p>';
    }

    // Charts
    buildDetailCharts(hist);

    // Telemetry table
    const tbody = document.getElementById('telemetryTableBody');
    document.getElementById('detailHistCount').textContent = `${hist.length} records`;
    tbody.innerHTML = [...hist].reverse().slice(0, 50).map(h => `
    <tr>
      <td>${formatTimeShort(h.timestamp)}</td>
      <td>${h.speed} km/h</td>
      <td>${h.temperature}°C</td>
      <td>${h.battery}%</td>
      <td>${h.fuel ?? '—'}%</td>
      <td><span class="health-chip health-chip--${healthLabel(h.health_score ?? 100)}">${h.health_score ?? '—'}</span></td>
      <td>${h.driving_score ?? '—'}</td>
      <td style="font-size:11px;color:var(--gray-400)">${h.lat ?? '—'},${h.lng ?? ''}</td>
    </tr>`).join('');
}

function buildDetailCharts(hist) {
    const make = (id, label, color, fill = false, key = 'speed') => {
        const ctx = document.getElementById(id)?.getContext('2d');
        if (!ctx) return;
        if (state.detailCharts[id]) state.detailCharts[id].destroy();
        state.detailCharts[id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: hist.map(h => formatTimeShort(h.timestamp)),
                datasets: [{ label, data: hist.map(h => h[key]), borderColor: color, backgroundColor: fill ? color + '20' : 'transparent', borderWidth: 2.5, pointRadius: 2, tension: 0.4, fill }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                scales: { x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { color: '#F3F4F6' } }, y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 } } } },
                animation: { duration: 300 },
            }
        });
    };
    make('detailSpeedChart', 'Speed (km/h)', '#3B82F6', false, 'speed');
    make('detailTempChart', 'Temp (°C)', '#F59E0B', false, 'temperature');
    make('detailBatteryChart', 'Battery (%)', '#22C55E', true, 'battery');
}

function updateDetailCharts() {
    const vid = state.detailVehicleId;
    if (!vid) return;
    const hist = state.telemetryHistory[vid] || [];
    const update = (id, key) => {
        const c = state.detailCharts[id];
        if (!c) return;
        c.data.labels = hist.map(h => formatTimeShort(h.timestamp));
        c.data.datasets[0].data = hist.map(h => h[key]);
        c.update('none');
    };
    update('detailSpeedChart', 'speed');
    update('detailTempChart', 'temperature');
    update('detailBatteryChart', 'battery');
}

// ─── Alerts Page ──────────────────────────────────────────────────────────────
async function renderAlerts() {
    state.alerts = await apiFetch('/api/alerts');
    const list = document.getElementById('alertsList');
    const lbl = document.getElementById('alertsCountLabel');
    updateAlertBadge(state.alerts.length);
    lbl.textContent = `${state.alerts.length} active alert${state.alerts.length !== 1 ? 's' : ''}`;

    if (!state.alerts.length) {
        list.innerHTML = `<div class="alert-empty"><div class="alert-empty-icon">✅</div><div class="alert-empty-text">No active alerts — fleet is healthy!</div></div>`;
        return;
    }
    list.innerHTML = state.alerts.map(a => `
    <div class="alert-card alert-card--${a.type.replace(' ', '\\ ')}">
      <div class="alert-icon">${alertIcon(a.type)}</div>
      <div class="alert-body">
        <div class="alert-type">⚠ ${escHtml(a.type)} detected</div>
        <div class="alert-vehicle">Vehicle: ${escHtml(a.model)} · ${escHtml(a.license_plate)}</div>
        <div class="alert-value">${alertValueLabel(a.type, a.value)}</div>
        <div class="alert-time">${formatTimeShort(a.created_at)}</div>
      </div>
      <button class="alert-dismiss" data-alert-id="${a.id}">Dismiss</button>
    </div>`).join('');

    list.querySelectorAll('[data-alert-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await apiPost(`/api/alerts/${btn.dataset.alertId}/dismiss`);
            renderAlerts();
        });
    });
}

function alertIcon(type) {
    return { 'Overspeed': '🚀', 'Overheating': '🌡️', 'Low Battery': '🔋' }[type] || '⚠️';
}

function alertValueLabel(type, value) {
    if (type === 'Overspeed') return `Speed: ${value} km/h (limit: 120 km/h)`;
    if (type === 'Overheating') return `Temperature: ${value}°C (limit: 90°C)`;
    if (type === 'Low Battery') return `Battery: ${value}% (threshold: 15%)`;
    return `Value: ${value}`;
}

function updateAlertBadge(count) {
    const badge = document.getElementById('alertCountBadge');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
}

// ─── Map ──────────────────────────────────────────────────────────────────────
let leafletMap = null;

function initMap() {
    if (leafletMap) { leafletMap.invalidateSize(); updateMapMarkers(); return; }
    leafletMap = L.map('leafletMap', { zoomControl: true }).setView([17.385, 78.486], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19
    }).addTo(leafletMap);

    // Load Geofences
    apiFetch('/api/geofences').then(zones => {
        zones.forEach(z => {
            L.circle([z.center_lat, z.center_lng], {
                color: z.color,
                fillColor: z.color,
                fillOpacity: 0.1,
                radius: z.radius_km * 1000,
                weight: 2,
                dashArray: z.type === 'restricted' ? '5, 5' : ''
            }).addTo(leafletMap).bindPopup(`<b>${z.name}</b><br/>${z.type === 'restricted' ? 'Restricted Zone' : 'Authorized Zone'}`);
        });
    }).catch(console.error);

    setupMapReplay();
    updateMapMarkers();
}

let replayData = null;
let replayMarker = null;

function setupMapReplay() {
    const sel = document.getElementById('replayVehicleSelect');
    const wrap = document.getElementById('replaySliderWrap');
    const slider = document.getElementById('replaySlider');
    const timeDisp = document.getElementById('replayTimeDisplay');

    // Populate select
    sel.innerHTML = '<option value="">Live Fleet View</option>' + state.vehicles.map(v => `<option value="${v.id}">${v.model} (${v.license_plate})</option>`).join('');

    sel.addEventListener('change', async (e) => {
        const vid = e.target.value;
        if (!vid) {
            // Back to live view
            wrap.style.display = 'none';
            replayData = null;
            if (replayMarker) { leafletMap.removeLayer(replayMarker); replayMarker = null; }
            Object.values(state.mapMarkers).forEach(m => m.setOpacity(1));
            return;
        }

        // Enter replay mode
        Object.values(state.mapMarkers).forEach(m => m.setOpacity(0.2)); // Dim live markers
        try {
            replayData = await apiFetch(`/api/telemetry/${vid}/replay`);
            if (!replayData.length) throw new Error('No historic data');
            wrap.style.display = 'flex';
            slider.max = replayData.length - 1;
            slider.value = replayData.length - 1;
            updateReplayFrame(replayData.length - 1);
        } catch (err) {
            showToast('No history available for replay');
            sel.value = '';
            wrap.style.display = 'none';
            Object.values(state.mapMarkers).forEach(m => m.setOpacity(1));
        }
    });

    slider.addEventListener('input', (e) => updateReplayFrame(parseInt(e.target.value)));
}

function updateReplayFrame(idx) {
    if (!replayData || !replayData[idx]) return;
    const frame = replayData[idx];
    document.getElementById('replayTimeDisplay').textContent = formatTimeShort(frame.timestamp);

    const v = state.vehicles.find(vv => vv.id === document.getElementById('replayVehicleSelect').value);
    const hs = frame.health_score ?? 100;
    const status = (frame.speed > 100 || frame.battery < 30) ? 'Warning' : 'Normal'; // Approx status for replay

    const popup = `
    <div>
      <div class="popup-title">⏪ REPLAY: ${v ? v.model : 'Unknown'}</div>
      <div class="popup-row"><span>Time</span><span class="popup-val">${formatTimeShort(frame.timestamp)}</span></div>
      <div class="popup-row"><span>Speed</span><span class="popup-val">${frame.speed} km/h</span></div>
      <div class="popup-row"><span>Temp</span><span class="popup-val">${frame.temperature}°C</span></div>
      <div class="popup-row"><span>Battery</span><span class="popup-val">${frame.battery}%</span></div>
    </div>`;

    if (!replayMarker) {
        replayMarker = L.marker([frame.lat, frame.lng], { icon: markerIcon(status) }).addTo(leafletMap).bindPopup(popup);
        leafletMap.panTo([frame.lat, frame.lng]);
    } else {
        replayMarker.setLatLng([frame.lat, frame.lng]).setIcon(markerIcon(status));
        replayMarker.getPopup()?.setContent(popup);
    }
}

function markerIcon(status) {
    const c = { Normal: '#22C55E', Warning: '#FBBF24', Critical: '#EF4444' }[status] || '#22C55E';
    return L.divIcon({
        html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
      <ellipse cx="16" cy="37" rx="8" ry="3" fill="rgba(0,0,0,.2)"/>
      <path d="M16 0C8.27 0 2 6.27 2 14c0 9.75 14 26 14 26S30 23.75 30 14C30 6.27 23.73 0 16 0z" fill="${c}"/>
      <circle cx="16" cy="14" r="7" fill="white" fill-opacity=".9"/>
      <text x="16" y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="${c}">🚗</text>
    </svg>`,
        iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40], className: ''
    });
}

function updateMapMarkers() {
    if (!leafletMap) return;
    state.vehicles.forEach(v => {
        if (!v.latest) return;
        const { lat, lng } = v.latest;
        const hs = v.latest.healthScore ?? 100;
        const popup = `
      <div>
        <div class="popup-title">${escHtml(v.model)}</div>
        <div class="popup-row"><span>Plate</span><span class="popup-val">${v.license_plate}</span></div>
        <div class="popup-row"><span>Speed</span><span class="popup-val">${v.latest.speed} km/h</span></div>
        <div class="popup-row"><span>Temp</span><span class="popup-val">${v.latest.temperature}°C</span></div>
        <div class="popup-row"><span>Battery</span><span class="popup-val">${v.latest.battery}%</span></div>
        <div class="popup-row"><span>Health Score</span><span class="popup-val">${hs}</span></div>
        <div class="popup-row"><span>Status</span><span class="popup-val">${v.status}</span></div>
      </div>`;
        if (state.mapMarkers[v.id]) {
            if (!replayData) {
                state.mapMarkers[v.id].setLatLng([lat, lng]).setIcon(markerIcon(v.status)).setOpacity(1);
                state.mapMarkers[v.id].getPopup()?.setContent(popup);
            } else {
                state.mapMarkers[v.id].setLatLng([lat, lng]).setIcon(markerIcon(v.status));
                state.mapMarkers[v.id].getPopup()?.setContent(popup);
                // Keep opacity at 0.2 if in replay mode
            }
        } else {
            state.mapMarkers[v.id] = L.marker([lat, lng], { icon: markerIcon(v.status), opacity: replayData ? 0.2 : 1 }).addTo(leafletMap).bindPopup(popup);
        }
    });
    Object.keys(state.mapMarkers).forEach(id => {
        if (!state.vehicles.find(v => v.id === id)) { leafletMap.removeLayer(state.mapMarkers[id]); delete state.mapMarkers[id]; }
    });
}

// ─── Analytics Page ───────────────────────────────────────────────────────────
function populateAnalyticsSelect() {
    const sel = document.getElementById('analyticsVehicleSelect');
    const cur = sel.value;
    sel.innerHTML = state.vehicles.map(v => `<option value="${v.id}" ${v.id === cur ? 'selected' : ''}>${escHtml(v.model)} — ${v.license_plate}</option>`).join('');
    if (!state.analyticsVehicleId || !state.vehicles.find(v => v.id === state.analyticsVehicleId))
        state.analyticsVehicleId = state.vehicles[0]?.id || null;
    sel.value = state.analyticsVehicleId;
}

function initAnalyticsCharts() {
    const make = (id, label, color, fill = false) => {
        const ctx = document.getElementById(id)?.getContext('2d');
        if (!ctx) return;
        if (state.analyticsCharts[id]) state.analyticsCharts[id].destroy();
        state.analyticsCharts[id] = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: fill ? color + '20' : 'transparent', borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, tension: 0.4, fill }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => ` ${label}: ${ctx.parsed.y.toFixed(1)}` } } },
                scales: { x: { ticks: { maxTicksLimit: 10, font: { size: 10 } }, grid: { color: '#F3F4F6' } }, y: { grid: { color: '#F3F4F6' }, ticks: { font: { size: 10 } } } },
                animation: { duration: 300 },
            }
        });
    };
    make('analyticsSpeedChart', 'Speed (km/h)', '#3B82F6');
    make('analyticsTempChart', 'Temp (°C)', '#F59E0B');
    make('analyticsBatteryChart', 'Battery (%)', '#22C55E', true);
    updateAnalyticsCharts();
}

async function updateAnalyticsCharts() {
    if (!state.analyticsVehicleId) return;
    const vid = state.analyticsVehicleId;
    if ((state.telemetryHistory[vid] || []).length < 5) await apiFetch(`/api/telemetry/${vid}`).then(r => state.telemetryHistory[vid] = r);
    const hist = (state.telemetryHistory[vid] || []).slice(-60);
    const labels = hist.map(h => formatTimeShort(h.timestamp));
    const upd = (id, key) => {
        const c = state.analyticsCharts[id]; if (!c) return;
        c.data.labels = labels; c.data.datasets[0].data = hist.map(h => h[key]); c.update('none');
    };
    upd('analyticsSpeedChart', 'speed');
    upd('analyticsTempChart', 'temperature');
    upd('analyticsBatteryChart', 'battery');
}

// ─── Maintenance Page ─────────────────────────────────────────────────────────
async function renderMaintenance() {
    const rows = await apiFetch('/api/maintenance');
    const grid = document.getElementById('maintenanceGrid');
    if (!rows.length) { grid.innerHTML = '<p style="color:var(--gray-400)">No maintenance records found.</p>'; return; }
    grid.innerHTML = rows.map(m => {
        const cls = maintClass(m.next_service);
        return `
    <div class="maint-card">
      <div class="maint-card-header">
        <div><div class="maint-model">${escHtml(m.model)}</div><div class="maint-type">${escHtml(m.type || '')}</div></div>
        <span class="maint-plate">${escHtml(m.license_plate)}</span>
      </div>
      <div class="maint-rows">
        <div class="maint-row"><span class="maint-row-label">Last Service</span><span class="maint-row-value">${m.last_service || 'N/A'}</span></div>
        <div class="maint-row"><span class="maint-row-label">Next Service</span><span class="maint-row-value ${cls}">${m.next_service || 'N/A'}</span></div>
      </div>
      ${m.notes ? `<div class="maint-notes">📝 ${escHtml(m.notes)}</div>` : ''}
    </div>`;
    }).join('');
}

function maintClass(dateStr) {
    if (!dateStr) return '';
    const diff = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'maint-overdue';
    if (diff < 14) return 'maint-soon';
    return 'maint-ok';
}

// ─── Modals & Toolbar ─────────────────────────────────────────────────────────
function setupModals() {
    const addBtn = document.getElementById('addVehicleBtn');
    const overlay = document.getElementById('modalOverlay');
    const form = document.getElementById('vehicleForm');
    addBtn.addEventListener('click', () => overlay.classList.add('open'));
    document.getElementById('modalClose').addEventListener('click', () => { overlay.classList.remove('open'); form.reset(); });
    document.getElementById('modalCancelBtn').addEventListener('click', () => { overlay.classList.remove('open'); form.reset(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.classList.remove('open'); form.reset(); } });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const model = document.getElementById('vehicleModel').value.trim();
        const type = document.getElementById('vehicleType').value;
        const plate = document.getElementById('vehiclePlate').value.trim();
        const btn = form.querySelector('.btn-primary');
        btn.disabled = true; btn.textContent = 'Registering…';
        try {
            const nv = await apiPost('/api/vehicles', { model, type, license_plate: plate });
            state.vehicles.unshift({ ...nv, status: 'Normal', latest: null });
            overlay.classList.remove('open'); form.reset();
            showToast(`${model} registered!`);
            document.getElementById('vehicleCountBadge').textContent = state.vehicles.length;
            if (state.currentPage === 'vehicles') updateVehicleCards();
            if (state.currentPage === 'dashboard') { updateDashboardFleetList(); updateDashboardStats(); }
        } catch { showToast('Registration failed.'); }
        finally { btn.disabled = false; btn.textContent = 'Register Vehicle'; }
    });

    document.getElementById('detailBackBtn').addEventListener('click', () => history.back());
    document.getElementById('dismissAllBtn').addEventListener('click', async () => {
        await apiPost('/api/alerts/dismiss-all');
        renderAlerts();
        showToast('All alerts dismissed');
    });
}

function setupVehicleToolbar() {
    document.getElementById('vehicleSearch').addEventListener('input', updateVehicleCards);
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.filter;
            updateVehicleCards();
        });
    });
    document.getElementById('viewAllVehiclesLink').addEventListener('click', e => { e.preventDefault(); location.hash = '#vehicles'; });
}

function setupAnalyticsSelect() {
    document.getElementById('analyticsVehicleSelect').addEventListener('change', function () {
        state.analyticsVehicleId = this.value;
        updateAnalyticsCharts();
    });
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
    const el = document.getElementById('topbarTime');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ─── Utilities ────────────────────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function setText(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function healthLabel(score) {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Poor';
}
function drivingLabel(score) {
    if (score >= 85) return 'Safe Driving';
    if (score >= 70) return 'Moderate';
    if (score >= 50) return 'Risky';
    return 'Dangerous';
}
function formatTime(ts) {
    if (!ts) return '—';
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return new Date(ts).toLocaleTimeString();
}
function formatTimeShort(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
    await fetchVehicles();

    document.querySelectorAll('.nav-item').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); location.hash = `#${a.dataset.page}`; });
    });

    setupModals();
    setupVehicleToolbar();
    setupAnalyticsSelect();
    connectWS();

    const initial = location.hash.replace('#', '') || 'dashboard';
    if (initial.startsWith('vehicle/')) {
        state.detailVehicleId = initial.split('/')[1];
        navigate('vehicledetail');
    } else {
        navigate(initial);
    }

    updateDashboardFleetList();
    document.getElementById('vehicleCountBadge').textContent = state.vehicles.length;
}

document.addEventListener('DOMContentLoaded', init);
