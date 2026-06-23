const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');
const BACKUP_FILE = path.join(DATA_DIR, 'projects.backup.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DISCIPLINES = ['Distribution', 'Transmission', 'Substation'];

// ── Migration ───────────────────────────────────────────────────────────────
// Converts old single-discipline projects into the new `segments` shape, and
// the old numeric teamCapacity into a per-discipline object. Idempotent: data
// already in the new shape passes through untouched.
function migrate(data) {
  if (!data || typeof data !== 'object') return { projects: [], teamCapacity: defaultCapacity() };

  data.projects = (data.projects || []).map(p => {
    if (Array.isArray(p.segments)) return p; // already migrated
    const seg = {
      discipline: p.discipline || 'Transmission',
      value:  p.value  ?? null,
      margin: p.margin ?? null,
      rate:   p.rate   ?? null,
      resources: p.resources || {}
    };
    // Strip the old per-project financial/discipline fields; keep project-level meta
    const { discipline, value, margin, rate, resources, ...rest } = p;
    return { ...rest, segments: [seg] };
  });

  // teamCapacity: number → split evenly across disciplines
  if (typeof data.teamCapacity === 'number') {
    const each = +(data.teamCapacity / DISCIPLINES.length).toFixed(2);
    data.teamCapacity = Object.fromEntries(DISCIPLINES.map(d => [d, each]));
  } else if (!data.teamCapacity || typeof data.teamCapacity !== 'object') {
    data.teamCapacity = defaultCapacity();
  }

  if (typeof data.darkMode !== 'boolean') data.darkMode = false;
  return data;
}

function defaultCapacity() {
  return Object.fromEntries(DISCIPLINES.map(d => [d, 3]));
}

function readData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return migrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch(e) {}
  }
  // Fall back to backup if main file is corrupt/missing
  if (fs.existsSync(BACKUP_FILE)) {
    try { return migrate(JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'))); } catch(e) {}
  }
  return { projects: [], teamCapacity: defaultCapacity(), darkMode: false };
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
  if (req.body.teamCapacity !== undefined) data.teamCapacity = req.body.teamCapacity;
  if (req.body.darkMode !== undefined) data.darkMode = req.body.darkMode;
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
  // Migrate old-format backups (single-discipline projects, numeric capacity)
  // into the new segment shape before persisting.
  const migrated = migrate(req.body);
  writeData(migrated);
  res.json({ ok: true, count: migrated.projects.length });
});

app.listen(PORT, () => {
  console.log(`\n✅ Loadboard running at http://localhost:${PORT}\n`);
});
