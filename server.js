const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { projects: [], teamCapacity: 10 };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

app.listen(PORT, () => {
  console.log(`\n✅ Loadboard running at http://localhost:${PORT}\n`);
});
