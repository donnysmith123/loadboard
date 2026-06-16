const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');
const BACKUP_FILE = path.join(DATA_DIR, 'projects.backup.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  }
  // Fall back to backup if main file is corrupt/missing
  if (fs.existsSync(BACKUP_FILE)) {
    try { return JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); } catch(e) {}
  }
  return { projects: [], teamCapacity: 10 };
}

function writeData(data) {
  const json = JSON.stringify(data, null, 2);
  // Write backup first, then main — so a crash mid-write never loses both
  if (fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(BACKUP_FILE, fs.readFileSync(DATA_FILE));
  }
  fs.writeFileSync(DATA_FILE, json);
}

app.get('/api/projects', (req, res) => {
  res.json(readData());
});

app.post('/api/projects', (req, res) => {
  const data = readData();
  const project = { ...req.body, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
  data.projects.push(project);
  writeData(data);
  res.json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const data = readData();
  const idx = data.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.projects[idx] = { ...req.body, id: req.params.id };
  writeData(data);
  res.json(data.projects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  const data = readData();
  data.projects = data.projects.filter(p => p.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

app.put('/api/settings', (req, res) => {
  const data = readData();
  data.teamCapacity = req.body.teamCapacity ?? data.teamCapacity;
  writeData(data);
  res.json({ ok: true });
});

// Restore from backup file — requires confirmation token from UI
app.post('/api/restore', (req, res) => {
  if (req.headers['x-restore-confirm'] !== 'yes') {
    return res.status(403).json({ error: 'Missing confirmation header' });
  }
  if (!req.body || !Array.isArray(req.body.projects)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  writeData(req.body);
  res.json({ ok: true, count: req.body.projects.length });
});

app.listen(PORT, () => {
  console.log(`\n✅ Loadboard running at http://localhost:${PORT}\n`);
});
