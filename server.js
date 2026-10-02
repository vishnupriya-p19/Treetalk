// TreeTalk Guardian — backend (final)
// Ingests readings from the gateway (or the dashboard's manual test box),
// stores history in a flat JSON file, pushes live updates over WebSocket,
// and flags SOS events with location for instant map zoom + directions.

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const INGEST_KEY = process.env.INGEST_KEY || 'change-this-shared-secret';
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MAX_HISTORY_PER_NODE = 500;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(STORE_FILE)) {
  fs.writeFileSync(STORE_FILE, JSON.stringify({ nodes: {}, alerts: [] }, null, 2));
}

function loadStore() { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
function saveStore(store) { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); }

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.post('/api/ingest', (req, res) => {
  if (req.headers['x-api-key'] !== INGEST_KEY) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  const reading = req.body;
  if (!reading || !reading.id) {
    return res.status(400).json({ error: 'missing node id' });
  }

  const store = loadStore();
  const now = new Date().toISOString();
  reading.receivedAt = now;

  if (!store.nodes[reading.id]) store.nodes[reading.id] = { id: reading.id, history: [] };
  const node = store.nodes[reading.id];
  node.latest = reading;
  node.history.push(reading);
  if (node.history.length > MAX_HISTORY_PER_NODE) node.history.shift();

  const alerts = [];
  if (reading.sos) alerts.push({ type: 'SOS', message: `SOS button pressed at ${reading.id}` });
  if (reading.tiltAlert) alerts.push({ type: 'TILT', message: `${reading.id} is leaning beyond safe threshold` });
  if (reading.soundAlert) alerts.push({ type: 'SOUND', message: `Possible distress sound detected near ${reading.id}` });
  if (typeof reading.soil === 'number' && reading.soil < 25) alerts.push({ type: 'DRY_SOIL', message: `${reading.id} soil moisture is low (${reading.soil}%)` });

  const storedAlerts = alerts.map(a => ({
    ...a, nodeId: reading.id, lat: reading.lat, lon: reading.lon, fix: reading.fix, time: now
  }));
  store.alerts.unshift(...storedAlerts);
  store.alerts = store.alerts.slice(0, 200);

  saveStore(store);

  io.emit('reading', reading);
  storedAlerts.forEach(a => io.emit('alert', a));

  res.json({ ok: true, alerts: storedAlerts.length });
});

app.get('/api/nodes', (req, res) => {
  const store = loadStore();
  res.json(Object.values(store.nodes).map(n => n.latest));
});

app.get('/api/nodes/:id/history', (req, res) => {
  const store = loadStore();
  const node = store.nodes[req.params.id];
  if (!node) return res.status(404).json({ error: 'unknown node' });
  res.json(node.history);
});

app.get('/api/alerts', (req, res) => {
  res.json(loadStore().alerts);
});

io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);
});

server.listen(PORT, () => {
  console.log(`TreeTalk Guardian backend running on port ${PORT}`);
});
