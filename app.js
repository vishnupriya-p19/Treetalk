const socket = io();

const connStatus = document.getElementById('connStatus');
const connLabel = document.getElementById('connLabel');
const sosBanner = document.getElementById('sosBanner');
const sosText = document.getElementById('sosText');
const sosDirections = document.getElementById('sosDirections');
const nodeGrid = document.getElementById('nodeGrid');
const nodeCount = document.getElementById('nodeCount');
const alertList = document.getElementById('alertList');
const chartNodeSelect = document.getElementById('chartNodeSelect');

const nodesById = {};
let map, historyChart;
const markersById = {};
let sosMarker = null;

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([19.0760, 72.8777], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function nodeStatus(reading) {
  if (reading.sos) return 'sos';
  if (reading.tiltAlert || reading.soundAlert) return 'alert';
  return 'ok';
}

function markerColor(status) {
  return status === 'sos' ? '#D1495B' : status === 'alert' ? '#E8A23D' : '#4FA57B';
}

function upsertMarker(reading) {
  if (!reading.fix || !reading.lat || !reading.lon) return;
  const status = nodeStatus(reading);
  const color = markerColor(status);
  if (markersById[reading.id]) {
    markersById[reading.id].setLatLng([reading.lat, reading.lon]);
    markersById[reading.id].setStyle({ color, fillColor: color });
  } else {
    const marker = L.circleMarker([reading.lat, reading.lon], {
      radius: 10, color, fillColor: color, fillOpacity: 0.55, weight: 2
    }).addTo(map);
    marker.bindPopup(reading.id);
    markersById[reading.id] = marker;
  }
  markersById[reading.id].setPopupContent(
    `<b>${reading.id}</b><br>${reading.temp?.toFixed?.(1) ?? '--'}°C<br>Soil ${reading.soil ?? '--'}%`
  );
}

// ---- SOS auto-locate: fly to the node, drop a pulsing marker, update banner ----
function handleSOSLocation(reading) {
  if (!reading.fix || !reading.lat || !reading.lon) {
    sosText.textContent = `🚨 SOS from ${reading.id} - no GPS fix yet, location unavailable`;
    sosDirections.style.display = 'none';
    sosBanner.hidden = false;
    return;
  }

  map.flyTo([reading.lat, reading.lon], 17, { duration: 1.2 });

  if (sosMarker) map.removeLayer(sosMarker);
  sosMarker = L.circleMarker([reading.lat, reading.lon], {
    radius: 16, color: '#D1495B', fillColor: '#D1495B', fillOpacity: 0.35, weight: 3
  }).addTo(map).bindPopup(`SOS: ${reading.id}`).openPopup();

  sosText.textContent = `🚨 SOS from ${reading.id} at ${reading.lat.toFixed(5)}, ${reading.lon.toFixed(5)}`;
  sosDirections.href = `https://www.google.com/maps/search/?api=1&query=${reading.lat},${reading.lon}`;
  sosDirections.style.display = 'inline-block';
  sosBanner.hidden = false;
}

function renderNodeCards() {
  const ids = Object.keys(nodesById);
  nodeCount.textContent = `${ids.length} node${ids.length === 1 ? '' : 's'} reporting`;
  if (ids.length === 0) {
    nodeGrid.innerHTML = '<p class="empty">Waiting for the first packet from the gateway…</p>';
    return;
  }
  nodeGrid.innerHTML = ids.map(id => {
    const r = nodesById[id];
    const status = nodeStatus(r);
    const statusLabel = status === 'sos' ? 'SOS' : status === 'alert' ? 'Attention' : 'Healthy';
    const ago = r.receivedAt ? timeAgo(r.receivedAt) : '--';
    return `
      <div class="node-card status-${status}">
        <h3>${id} <span class="badge">${statusLabel}</span></h3>
        <div class="node-oled">${id.padEnd(10)}${status === 'sos' ? '!! SOS !!' : status === 'alert' ? 'RISK' : 'OK'}
${(r.temp ?? 0).toFixed(1)}C Soil:${r.soil ?? '--'}%
${r.fix ? `${r.lat?.toFixed(4)},${r.lon?.toFixed(4)}` : 'GPS: searching...'}</div>
        <p style="margin:8px 0 0;font-size:11px;color:var(--ink-dim)">updated ${ago}</p>
      </div>`;
  }).join('');
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function pushAlert(alert) {
  if (alertList.querySelector('.empty')) alertList.innerHTML = '';
  const li = document.createElement('li');
  li.className = alert.type;
  li.innerHTML = `${alert.message}<span class="time">${new Date(alert.time).toLocaleString()}</span>`;
  alertList.prepend(li);

  if (alert.type === 'SOS') {
    handleSOSLocation({ id: alert.nodeId, lat: alert.lat, lon: alert.lon, fix: alert.fix });
  }
}

document.getElementById('sosDismiss').addEventListener('click', () => sosBanner.hidden = true);

function initChart() {
  const ctx = document.getElementById('historyChart');
  historyChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Temp °C', data: [], borderColor: '#E8A23D', tension: 0.3 },
      { label: 'Soil %', data: [], borderColor: '#4FA57B', tension: 0.3 }
    ]},
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#EDEAE0', font: { family: 'IBM Plex Mono', size: 11 } } } },
      scales: {
        x: { ticks: { color: '#9FB3A8', font: { size: 10 } }, grid: { color: '#24382E' } },
        y: { ticks: { color: '#9FB3A8' }, grid: { color: '#24382E' } }
      }
    }
  });
}

async function loadHistoryFor(nodeId) {
  if (!nodeId) return;
  const res = await fetch(`/api/nodes/${nodeId}/history`);
  const history = await res.json();
  historyChart.data.labels = history.map(h => new Date(h.receivedAt).toLocaleTimeString());
  historyChart.data.datasets[0].data = history.map(h => h.temp);
  historyChart.data.datasets[1].data = history.map(h => h.soil);
  historyChart.update();
}

chartNodeSelect.addEventListener('change', (e) => loadHistoryFor(e.target.value));

function refreshNodeSelect() {
  const current = chartNodeSelect.value;
  chartNodeSelect.innerHTML = Object.keys(nodesById).map(id => `<option value="${id}">${id}</option>`).join('');
  if (current && nodesById[current]) chartNodeSelect.value = current;
  else if (Object.keys(nodesById)[0]) loadHistoryFor(chartNodeSelect.value = Object.keys(nodesById)[0]);
}

function handleReading(reading) {
  nodesById[reading.id] = reading;
  upsertMarker(reading);
  renderNodeCards();
  refreshNodeSelect();
  if (chartNodeSelect.value === reading.id) loadHistoryFor(reading.id);

  if (reading.sos) handleSOSLocation(reading);
}

socket.on('connect', () => { connStatus.classList.add('online'); connLabel.textContent = 'Live'; });
socket.on('disconnect', () => { connStatus.classList.remove('online'); connLabel.textContent = 'Reconnecting…'; });
socket.on('reading', handleReading);
socket.on('alert', pushAlert);

async function bootstrap() {
  initMap();
  initChart();
  const [nodesRes, alertsRes] = await Promise.all([fetch('/api/nodes'), fetch('/api/alerts')]);
  const nodes = await nodesRes.json();
  const alerts = await alertsRes.json();
  nodes.forEach(handleReading);
  alerts.slice().reverse().forEach(pushAlert);
}
bootstrap();

// ---- Manual test box ----
const INGEST_KEY = 'Vishnupriya_tree2004';

async function sendManualReading(overrideSOS) {
  const statusEl = document.getElementById('manualStatus');
  const raw = document.getElementById('manualJson').value.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    statusEl.textContent = 'Invalid JSON - check for typos';
    statusEl.style.color = '#D1495B';
    return;
  }
  if (overrideSOS) parsed.sos = true;

  try {
    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': INGEST_KEY },
      body: JSON.stringify(parsed)
    });
    if (res.ok) {
      statusEl.textContent = 'Sent! Dashboard updating...';
      statusEl.style.color = '#4FA57B';
    } else {
      statusEl.textContent = 'Server rejected it: ' + res.status;
      statusEl.style.color = '#D1495B';
    }
  } catch (e) {
    statusEl.textContent = 'Network error: ' + e.message;
    statusEl.style.color = '#D1495B';
  }
}

document.getElementById('sendManual').addEventListener('click', () => sendManualReading(false));
document.getElementById('sendManualSOS').addEventListener('click', () => sendManualReading(true));
