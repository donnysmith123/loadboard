// ── State ─────────────────────────────────────────────────────────────────
let projects = [];
let teamCapacity = 10;
let editingId = null;
let activeSection = 'dashboard';
let dashChart = null, donutChart = null, timelineChart = null, resChart = null, valueChart = null;
let projectSort = { col: null, dir: 1 };
let projectFilters = { search: '', status: '', discipline: '' };
let viewFrom = null, viewTo = null;
let filterDiscipline = '';

// ── Constants ─────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STATUS_BADGE  = { active:'badge-green', probable:'badge-teal', bid:'badge-blue', 'on-hold':'badge-gray', completed:'badge-gray' };
const STATUS_LABEL  = { active:'Active', probable:'Probable', bid:'Bid', 'on-hold':'On Hold', completed:'Completed' };
const SECTION_TITLES = { dashboard:'Dashboard', projects:'Projects', resources:'Resource Demand', gantt:'Timeline', financials:'Financials', settings:'Settings' };

// Blue-green palette
const BAR_COLORS = [
  '#1a56a0','#0e7490','#059669','#2563eb',
  '#0d9488','#1d4ed8','#047857','#0284c7',
  '#065f46','#0f766e','#1e40af','#0369a1'
];

// ── API helpers ───────────────────────────────────────────────────────────
async function api(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    showServerError();
    throw err;
  }
}

function showServerError() {
  if (document.getElementById('server-error')) return;
  const banner = document.createElement('div');
  banner.id = 'server-error';
  banner.style = 'position:fixed;top:0;left:0;right:0;background:#1e3a5f;color:#fff;padding:12px 20px;font-size:13px;font-weight:500;z-index:9999;display:flex;align-items:center;gap:12px;';
  banner.innerHTML = `<i class="ti ti-alert-triangle" style="font-size:18px;flex-shrink:0;"></i>
    <span>Cannot connect to the local server. Run <code style="background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">npm start</code> in the loadboard folder, then open <strong>http://localhost:3000</strong>.</span>`;
  document.body.prepend(banner);
}

async function loadAll() {
  try {
    const data = await api('GET', '/api/projects');
    projects = data.projects || [];
    teamCapacity = data.teamCapacity ?? 10;
    document.getElementById('capacityInput').value = teamCapacity;
    document.getElementById('server-error')?.remove();
    renderAll();
  } catch(e) {}
}

// ── Time helpers ──────────────────────────────────────────────────────────
function monthToIdx(ym) {
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}
function idxToYM(idx) {
  const y = Math.floor(idx / 12), m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2,'0')}`;
}
function idxLabel(idx, short) {
  const y = Math.floor(idx / 12), m = idx % 12;
  return short ? MONTHS[m] : `${MONTHS[m]} '${String(y).slice(-2)}`;
}

function getFilteredProjects() {
  if (!filterDiscipline) return projects;
  return projects.filter(p => p.discipline === filterDiscipline);
}

function getViewRange() {
  const now = new Date();
  let mn, mx;
  const fp = getFilteredProjects();

  if (viewFrom) {
    mn = monthToIdx(viewFrom);
  } else {
    mn = now.getFullYear() * 12 + now.getMonth();
    for (const p of fp) {
      const s = monthToIdx(p.start);
      if (s != null) mn = Math.min(mn, s);
    }
  }

  if (viewTo) {
    mx = monthToIdx(viewTo);
  } else {
    mx = mn + 11;
    for (const p of fp) {
      const e = monthToIdx(p.end);
      if (e != null) mx = Math.max(mx, e);
    }
  }

  return [mn, Math.max(mn, mx)];
}

function getProjectsInView() {
  const [mn, mx] = getViewRange();
  return projects.filter(p => {
    if (filterDiscipline && p.discipline !== filterDiscipline) return false;
    const s = monthToIdx(p.start), e = monthToIdx(p.end);
    if (s == null || e == null) return false;
    return !(e < mn || s > mx);
  });
}

// ── Demand calculation ────────────────────────────────────────────────────
function getMonthlyDemand(weighted) {
  const [mn, mx] = getViewRange();
  const result = {};
  for (let i = mn; i <= mx; i++) result[i] = 0;
  for (const p of projects) {
    if (filterDiscipline && p.discipline !== filterDiscipline) continue;
    const factor = weighted ? (p.prob ?? 100) / 100 : 1;
    for (const [ym, val] of Object.entries(p.resources || {})) {
      const idx = monthToIdx(ym);
      if (idx != null && result[idx] !== undefined) result[idx] += (val || 0) * factor;
    }
  }
  return result;
}

// ── Formatting ────────────────────────────────────────────────────────────
function formatMoney(v) {
  if (!v || v === 0) return '—';
  const abs = Math.abs(v);
  let str;
  if (abs >= 1000000) str = '$' + (abs / 1000000).toFixed(1) + 'M';
  else if (abs >= 1000) str = '$' + Math.round(abs / 1000) + 'K';
  else str = '$' + abs.toLocaleString();
  return v < 0 ? '-' + str : str;
}

function projectLabel(p) {
  return p.client ? `${p.name} / ${p.client}` : p.name;
}

// ── View range ────────────────────────────────────────────────────────────
window.applyViewRange = function() {
  viewFrom = document.getElementById('view-from').value || null;
  viewTo   = document.getElementById('view-to').value   || null;
  renderAll();
};

window.resetViewRange = function() {
  viewFrom = viewTo = null;
  document.getElementById('view-from').value = '';
  document.getElementById('view-to').value   = '';
  renderAll();
};

window.applyDisciplineFilter = function() {
  filterDiscipline = document.getElementById('global-discipline').value;
  renderAll();
};

// ── Navigation ────────────────────────────────────────────────────────────
window.navigate = function(id) {
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === id));
  document.querySelectorAll('.section').forEach(el => el.classList.toggle('active', el.id === id));
  document.getElementById('topbar-title').textContent = SECTION_TITLES[id] || id;
  activeSection = id;
  renderSection(id);
};

function renderSection(id) {
  if (id === 'dashboard') renderDashboard();
  else if (id === 'projects') renderProjects();
  else if (id === 'resources') renderResources();
  else if (id === 'gantt') renderGantt();
  else if (id === 'financials') renderFinancials();
}

function renderAll() {
  updateMetrics();
  renderSection(activeSection);
}

// ── Metrics ───────────────────────────────────────────────────────────────
function updateMetrics() {
  const weighted = getMonthlyDemand(true);
  const best     = getMonthlyDemand(false);
  const peakW  = Math.max(0, ...Object.values(weighted));
  const peakBC = Math.max(0, ...Object.values(best));
  const inView = getProjectsInView();
  const allFiltered = filterDiscipline ? projects.filter(p => p.discipline === filterDiscipline) : projects;
  document.getElementById('m-total').textContent  = allFiltered.length;
  document.getElementById('m-active').textContent = allFiltered.filter(p => p.status === 'active').length;
  document.getElementById('m-peak-w').textContent  = peakW.toFixed(1);
  document.getElementById('m-peak-wc').textContent = peakBC.toFixed(1);
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const [mn, mx] = getViewRange();
  const labels = [], wData = [], bcData = [], capData = [];
  const weighted = getMonthlyDemand(true), best = getMonthlyDemand(false);
  for (let i = mn; i <= mx; i++) {
    labels.push(idxLabel(i));
    wData.push(+(weighted[i]||0).toFixed(1));
    bcData.push(+(best[i]||0).toFixed(1));
    capData.push(teamCapacity);
  }

  if (dashChart) { dashChart.destroy(); dashChart = null; }
  dashChart = new Chart(document.getElementById('dashChart'), {
    data: {
      labels,
      datasets: [
        { type:'bar',  label:'Expected FTEs',  data:wData,   backgroundColor:'rgba(26,86,160,0.7)',  borderColor:'#1a56a0', borderWidth:1, order:2, borderRadius:2 },
        { type:'line', label:'Best-case FTEs', data:bcData,  borderColor:'#0e7490', borderDash:[5,3], borderWidth:2, pointRadius:3, pointBackgroundColor:'#0e7490', fill:false, tension:0.3, order:1 },
        { type:'line', label:'Team capacity',  data:capData, borderColor:'#059669', borderDash:[8,4], borderWidth:1.5, pointRadius:0, fill:false, tension:0, order:0 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ ticks:{ autoSkip:labels.length>18, maxRotation:45, font:{size:11} }, grid:{ color:'rgba(0,0,0,0.04)' } },
        y:{ beginAtZero:true, grid:{ color:'rgba(0,0,0,0.04)' }, ticks:{ stepSize:1, font:{size:11} }, title:{ display:true, text:'FTEs', font:{size:11} } }
      }
    }
  });

  // Portfolio donut — project contract values within view range
  renderPortfolioDonut();

  renderTimelineChart();
}

function renderPortfolioDonut() {
  const inView = getProjectsInView();
  const withValue = inView.filter(p => parseFloat(p.value) > 0);

  if (donutChart) { donutChart.destroy(); donutChart = null; }

  if (!withValue.length) {
    // Fall back to resource-months by project
    const byProject = {};
    for (const p of inView) {
      const rm = Object.values(p.resources || {}).reduce((a,b) => a+(b||0), 0);
      if (rm > 0) byProject[projectLabel(p)] = rm;
    }
    const dLabels = Object.keys(byProject);
    const dData   = dLabels.map(k => +byProject[k].toFixed(1));
    if (!dLabels.length) return;
    donutChart = new Chart(document.getElementById('donutChart'), {
      type:'doughnut',
      data:{ labels:dLabels, datasets:[{ data:dData, backgroundColor:BAR_COLORS.slice(0,dLabels.length), borderWidth:2, borderColor:'#fff' }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'bottom', labels:{ font:{size:11}, boxWidth:12, padding:8 } },
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw} res-mo` } } } }
    });
    return;
  }

  const pLabels = withValue.map(p => projectLabel(p));
  const pData   = withValue.map(p => parseFloat(p.value));
  donutChart = new Chart(document.getElementById('donutChart'), {
    type:'doughnut',
    data:{ labels:pLabels, datasets:[{ data:pData, backgroundColor:BAR_COLORS.slice(0,pLabels.length), borderWidth:2, borderColor:'#fff' }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ font:{size:11}, boxWidth:12, padding:8 } },
        tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${formatMoney(ctx.raw)}` } } } }
  });
}

// ── Stacked area timeline ─────────────────────────────────────────────────
function renderTimelineChart() {
  const [mn, mx] = getViewRange();
  const labels = [];
  for (let i = mn; i <= mx; i++) {
    const m = i % 12, y = Math.floor(i / 12);
    labels.push((m === 0 || i === mn) ? [MONTHS[m], String(y)] : MONTHS[m]);
  }

  const projectsWithData = getFilteredProjects().filter(p =>
    p.start && p.end && Object.values(p.resources || {}).some(v => (v||0) > 0)
  );

  if (timelineChart) { timelineChart.destroy(); timelineChart = null; }
  if (!projectsWithData.length) return;

  const datasets = projectsWithData.map((p, pi) => {
    const color = BAR_COLORS[pi % BAR_COLORS.length];
    const data = [];
    for (let i = mn; i <= mx; i++) {
      const ym  = idxToYM(i);
      const val = ((p.resources || {})[ym] || 0) * (p.prob ?? 100) / 100;
      data.push(+val.toFixed(2));
    }
    return { label:projectLabel(p), data, backgroundColor:color+'aa', borderColor:color, borderWidth:1.5, fill:true, tension:0.2, pointRadius:0, pointHoverRadius:4 };
  });

  timelineChart = new Chart(document.getElementById('timelineChart'), {
    type:'line',
    data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ position:'bottom', labels:{ font:{size:11}, boxWidth:12, padding:8, usePointStyle:true } } },
      scales:{
        x:{ stacked:true, ticks:{ autoSkip:false, maxRotation:0, font:{size:10} }, grid:{ color:'rgba(0,0,0,0.04)' } },
        y:{ stacked:true, beginAtZero:true, grid:{ color:'rgba(0,0,0,0.04)' }, ticks:{ font:{size:11} }, title:{ display:true, text:'Expected FTEs', font:{size:11} } }
      }
    }
  });
}

// ── Projects ──────────────────────────────────────────────────────────────
window.setSort = function(col) {
  if (projectSort.col === col) projectSort.dir *= -1;
  else { projectSort.col = col; projectSort.dir = 1; }
  renderProjects();
};

window.clearFilters = function() {
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-discipline').value = '';
  projectFilters = { search:'', status:'', discipline:'' };
  renderProjects();
};

function renderProjects() {
  projectFilters.search     = document.getElementById('filter-search')?.value || '';
  projectFilters.status     = document.getElementById('filter-status')?.value || '';
  projectFilters.discipline = document.getElementById('filter-discipline')?.value || '';

  let filtered = getFilteredProjects().filter(p => {
    const q = projectFilters.search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !(p.client||'').toLowerCase().includes(q)) return false;
    if (projectFilters.status     && p.status     !== projectFilters.status)     return false;
    if (projectFilters.discipline && p.discipline !== projectFilters.discipline) return false;
    return true;
  });

  if (projectSort.col) {
    filtered = filtered.slice().sort((a, b) => {
      let av, bv;
      switch (projectSort.col) {
        case 'name':       av = a.name;        bv = b.name;        break;
        case 'discipline': av = a.discipline||''; bv = b.discipline||''; break;
        case 'start':      av = a.start||'';   bv = b.start||'';   break;
        case 'status':     av = a.status||'';  bv = b.status||'';  break;
        case 'prob':       av = a.prob??100;   bv = b.prob??100;   break;
        case 'value':      av = parseFloat(a.value)||0; bv = parseFloat(b.value)||0; break;
        case 'demand':
          av = Object.values(a.resources||{}).reduce((s,v)=>s+(v||0),0);
          bv = Object.values(b.resources||{}).reduce((s,v)=>s+(v||0),0);
          break;
        default: av = bv = '';
      }
      if (av < bv) return -projectSort.dir;
      if (av > bv) return projectSort.dir;
      return 0;
    });
  }

  document.querySelectorAll('.project-table th[data-col]').forEach(th => {
    th.classList.toggle('sorted-asc',  projectSort.col === th.dataset.col && projectSort.dir ===  1);
    th.classList.toggle('sorted-desc', projectSort.col === th.dataset.col && projectSort.dir === -1);
  });

  const el = document.getElementById('projects-body');
  if (!filtered.length) {
    const msg = projects.length ? 'No projects match your filters.' : 'No projects yet — click <strong>Add project</strong> to get started.';
    el.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">${msg}</td></tr>`;
    return;
  }

  el.innerHTML = filtered.map(p => {
    const rm = Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    const hasNotes = p.notes && p.notes.trim();
    return `<tr onclick="openEdit('${p.id}')"
        onmouseenter="showTooltip(event,'${p.id}')"
        onmouseleave="hideTooltip()">
      <td>
        <div class="proj-name-cell">
          <strong>${p.name}</strong>${hasNotes ? ' <span class="note-dot" title="Has notes">·</span>' : ''}
          ${p.client ? `<span class="proj-client">${p.client}</span>` : ''}
        </div>
      </td>
      <td><span class="disc-tag">${p.discipline||'—'}</span></td>
      <td style="white-space:nowrap;font-size:12px;">${p.start||'—'} → ${p.end||'—'}</td>
      <td><span class="badge ${STATUS_BADGE[p.status]||'badge-gray'}">${STATUS_LABEL[p.status]||p.status}</span></td>
      <td style="font-size:12px;">${p.prob??100}%</td>
      <td style="font-size:12px;">${p.value ? formatMoney(parseFloat(p.value)) : '—'}</td>
      <td style="font-size:12px;">${rm>0?rm.toFixed(1):'—'}</td>
      <td><button class="btn btn-sm btn-icon" onclick="event.stopPropagation();openEdit('${p.id}')"><i class="ti ti-edit"></i></button></td>
    </tr>`;
  }).join('');
}

// ── Tooltip ───────────────────────────────────────────────────────────────
window.showTooltip = function(e, id) {
  const p = projects.find(x => x.id === id);
  if (!p || !p.notes?.trim()) return;
  const tip = document.getElementById('project-tooltip');
  tip.innerHTML = `<div class="tip-name">${projectLabel(p)}</div><div class="tip-notes">${p.notes}</div>`;
  tip.classList.add('visible');
  positionTooltip(e);
};
window.hideTooltip = function() {
  document.getElementById('project-tooltip').classList.remove('visible');
};
function positionTooltip(e) {
  const tip = document.getElementById('project-tooltip');
  const x = e.clientX + 14, y = e.clientY + 10;
  const maxX = window.innerWidth  - tip.offsetWidth  - 10;
  const maxY = window.innerHeight - tip.offsetHeight - 10;
  tip.style.left = Math.min(x, maxX) + 'px';
  tip.style.top  = Math.min(y, maxY) + 'px';
}
document.addEventListener('mousemove', e => {
  const tip = document.getElementById('project-tooltip');
  if (tip?.classList.contains('visible')) positionTooltip(e);
});

// ── Resource demand line chart ────────────────────────────────────────────
function renderResources() {
  const [mn, mx] = getViewRange();
  const labels = [], wData = [], bcData = [], capData = [];
  const weighted = getMonthlyDemand(true), best = getMonthlyDemand(false);
  for (let i = mn; i <= mx; i++) {
    labels.push(idxLabel(i));
    wData.push(+(weighted[i]||0).toFixed(2));
    bcData.push(+(best[i]||0).toFixed(2));
    capData.push(teamCapacity);
  }

  if (resChart) { resChart.destroy(); resChart = null; }
  resChart = new Chart(document.getElementById('resChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Expected FTEs',
          data: wData,
          borderColor: '#1a56a0',
          backgroundColor: 'rgba(26,86,160,0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#1a56a0',
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          fill: true,
          tension: 0.35
        },
        {
          label: 'Best-case FTEs',
          data: bcData,
          borderColor: '#059669',
          backgroundColor: 'rgba(5,150,105,0.06)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#059669',
          pointBorderColor: '#fff',
          pointBorderWidth: 1.5,
          borderDash: [6,3],
          fill: true,
          tension: 0.35
        },
        {
          label: 'Team capacity',
          data: capData,
          borderColor: '#0e7490',
          borderDash: [8,5],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { position:'top', align:'start', labels:{ font:{size:12}, boxWidth:16, padding:20, usePointStyle:true } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw} FTEs`
          }
        }
      },
      scales: {
        x: {
          ticks: { autoSkip: labels.length > 18, maxRotation: 45, font:{size:11} },
          grid: { color:'rgba(0,0,0,0.04)' }
        },
        y: {
          beginAtZero: true,
          grid: { color:'rgba(0,0,0,0.04)' },
          ticks: { stepSize:1, font:{size:12} },
          title: { display:true, text:'FTE Count', font:{size:12, weight:'500'}, color:'var(--text-muted)' }
        }
      }
    }
  });
}

// ── Gantt timeline ─────────────────────────────────────────────────────────
function renderGantt() {
  const [mn, mx] = getViewRange();
  const count = mx - mn + 1;
  const headerCells = [];
  for (let i = mn; i <= mx; i++) {
    const m = i % 12, y = Math.floor(i / 12);
    const isJan = m === 0 && i !== mn;
    const label = (m === 0 || i === mn)
      ? `${MONTHS[m]}<br><span class="gantt-year">${y}</span>`
      : MONTHS[m];
    headerCells.push(`<div class="gantt-month-label${isJan?' gantt-year-start':''}">${label}</div>`);
  }

  const inView = getProjectsInView();
  let bars = inView.map((p, pi) => {
    const s = monthToIdx(p.start), e = monthToIdx(p.end);
    if (s == null || e == null) return '';
    const left  = Math.max(0,   (s - mn) / count * 100);
    const right = Math.min(100, (e - mn + 1) / count * 100);
    const w = Math.max(0, right - left);
    const color = BAR_COLORS[pi % BAR_COLORS.length];
    const op = ((p.prob ?? 100) / 100).toFixed(2);
    const rm = Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    const dur = Math.max(1, monthToIdx(p.end) - monthToIdx(p.start) + 1);
    const avgFTE = rm > 0 ? rm / dur : 0;
    const barH = Math.max(18, Math.min(52, Math.round(avgFTE * 14 + 10)));
    const label = projectLabel(p);
    return `<div class="gantt-row">
      <div class="gantt-row-name" title="${label}">${label}</div>
      <div class="gantt-track" style="height:${barH}px;">
        <div class="gantt-bar" style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%;background:${color};opacity:${op};height:100%;"
          title="${label} | ${p.start}–${p.end} | ${rm.toFixed(1)} res-months${avgFTE?` | avg ${avgFTE.toFixed(1)} FTEs`:''}">
          ${w > 8 ? label : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  if (!bars.trim()) bars = '<div style="color:var(--text-muted);padding:1.5rem 0;font-size:13px;">No projects with date ranges in the current window.</div>';
  document.getElementById('gantt-header-months').innerHTML = headerCells.join('');
  document.getElementById('gantt-bars').innerHTML = bars;
}

// ── Financials ─────────────────────────────────────────────────────────────
function renderFinancials() {
  const fp = getFilteredProjects();
  const totalValue    = fp.reduce((s,p) => s+(parseFloat(p.value)||0), 0);
  const weightedValue = fp.reduce((s,p) => s+(parseFloat(p.value)||0)*(p.prob??100)/100, 0);
  const totalResMonths = fp.reduce((s,p) => s+Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0), 0);
  const totalLabor    = fp.reduce((s,p) => {
    const rm = Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    return s + rm * 160 * (parseFloat(p.rate)||0);
  }, 0);

  document.getElementById('fin-total-value').textContent    = totalValue    > 0 ? formatMoney(totalValue)    : '—';
  document.getElementById('fin-weighted-value').textContent = weightedValue > 0 ? formatMoney(weightedValue) : '—';
  document.getElementById('fin-res-months').textContent     = totalResMonths > 0 ? totalResMonths.toFixed(1) : '—';
  document.getElementById('fin-labor-cost').textContent     = totalLabor    > 0 ? formatMoney(totalLabor)    : '—';

  const rows = fp.map(p => {
    const rm       = Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    const rate     = parseFloat(p.rate)   || 0;
    const value    = parseFloat(p.value)  || 0;
    const margin   = parseFloat(p.margin) || null;
    const labor    = Math.round(rm * 160) * rate;
    const actualMargin = value > 0 && labor > 0 ? value - labor : null;
    const mColor = actualMargin != null ? (actualMargin >= 0 ? 'var(--green)' : 'var(--red)') : '';
    return `<tr onclick="openEdit('${p.id}')">
      <td><strong>${p.name}</strong>${p.client?`<span class="proj-client" style="display:block">${p.client}</span>`:''}</td>
      <td><span class="badge ${STATUS_BADGE[p.status]||'badge-gray'}">${STATUS_LABEL[p.status]||p.status}</span></td>
      <td style="text-align:right;">${value>0?formatMoney(value):'—'}</td>
      <td style="text-align:right;">${margin!=null?margin+'%':'—'}</td>
      <td style="text-align:right;">${rate>0?'$'+rate+'/hr':'—'}</td>
      <td style="text-align:right;">${rm>0?rm.toFixed(1):'—'}</td>
      <td style="text-align:right;">${labor>0?formatMoney(labor):'—'}</td>
      <td style="text-align:right;font-weight:600;color:${mColor}">${actualMargin!=null?formatMoney(actualMargin):'—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('fin-tbody').innerHTML = rows ||
    `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No projects yet.</td></tr>`;

  if (valueChart) { valueChart.destroy(); valueChart = null; }
  const pv = fp.filter(p => parseFloat(p.value) > 0);
  if (pv.length) {
    valueChart = new Chart(document.getElementById('valueChart'), {
      type:'bar',
      data:{
        labels: pv.map(p => projectLabel(p)),
        datasets:[{ label:'Contract Value', data:pv.map(p=>parseFloat(p.value)||0),
          backgroundColor: pv.map((_,i)=>BAR_COLORS[i%BAR_COLORS.length]+'cc'),
          borderColor:     pv.map((_,i)=>BAR_COLORS[i%BAR_COLORS.length]),
          borderWidth:1, borderRadius:4 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ' '+formatMoney(ctx.raw) } } },
        scales:{
          x:{ ticks:{ font:{size:11} }, grid:{ display:false } },
          y:{ beginAtZero:true, ticks:{ font:{size:11}, callback: v => formatMoney(v) }, grid:{ color:'rgba(0,0,0,0.04)' } }
        }
      }
    });
  }
}

// ── Planning calculator ────────────────────────────────────────────────────
window.updatePlanner = function() {
  const value    = parseFloat(document.getElementById('f-value').value)  || 0;
  const margin   = parseFloat(document.getElementById('f-margin').value);
  const rate     = parseFloat(document.getElementById('f-rate').value)   || 0;
  const start    = document.getElementById('f-start').value;
  const end      = document.getElementById('f-end').value;
  const duration = (start && end && monthToIdx(end) >= monthToIdx(start))
    ? monthToIdx(end) - monthToIdx(start) + 1 : null;

  const result  = document.getElementById('planner-result');
  const actions = document.getElementById('planner-actions');
  const canCalcFTEs = value > 0 && !isNaN(margin) && rate > 0 && duration;

  let html = '';

  if (canCalcFTEs) {
    const laborBudget = value * (1 - margin / 100);
    const ftesPerMonth = laborBudget / (duration * 160 * rate);
    document.getElementById('planner-ftes-val').textContent = ftesPerMonth.toFixed(2);
    actions.style.display = 'block';
    html += `<div class="planner-line planner-primary">
      <i class="ti ti-arrow-right"></i>
      <strong>${ftesPerMonth.toFixed(2)} FTEs/month</strong>
      <span class="planner-detail">labor ${formatMoney(laborBudget)} ÷ ${duration}mo ÷ 160hrs ÷ $${rate}/hr</span>
    </div>`;
  } else if (!canCalcFTEs) {
    actions.style.display = 'none';
    const missing = [];
    if (!value)            missing.push('budget');
    if (isNaN(margin))     missing.push('margin');
    if (!rate)             missing.push('rate');
    if (!duration)         missing.push('dates');
    html = `<span class="planner-hint">Need: ${missing.join(', ')}</span>`;
  }

  // Show what current monthly schedule implies
  const curInputs = document.querySelectorAll('#month-inputs input');
  let totalRM = 0;
  curInputs.forEach(inp => { totalRM += parseFloat(inp.value) || 0; });
  if (totalRM > 0 && rate > 0) {
    const impliedLabor = totalRM * 160 * rate;
    let impliedLine = `Schedule: ${totalRM.toFixed(1)} res-mo → est. labor ${formatMoney(impliedLabor)}`;
    if (value > 0) {
      const impliedMargin = (1 - impliedLabor / value) * 100;
      const col = impliedMargin >= 0 ? 'var(--green)' : 'var(--red)';
      impliedLine += ` → margin <strong style="color:${col}">${impliedMargin.toFixed(0)}%</strong>`;
    }
    html += `<div class="planner-line planner-implied">${impliedLine}</div>`;
  }

  result.innerHTML = html || '<span class="planner-hint">Enter value, margin, rate + dates</span>';
};

window.applyPlannedFTEs = function() {
  const value    = parseFloat(document.getElementById('f-value').value)  || 0;
  const margin   = parseFloat(document.getElementById('f-margin').value) || 0;
  const rate     = parseFloat(document.getElementById('f-rate').value)   || 0;
  const start    = document.getElementById('f-start').value;
  const end      = document.getElementById('f-end').value;
  if (!value || !rate || !start || !end) return;
  const duration     = Math.max(1, monthToIdx(end) - monthToIdx(start) + 1);
  const laborBudget  = value * (1 - margin / 100);
  const ftesPerMonth = laborBudget / (duration * 160 * rate);
  document.querySelectorAll('#month-inputs input').forEach(inp => {
    inp.value = ftesPerMonth.toFixed(2);
  });
  updatePlanner();
};

// ── Data backup & restore ──────────────────────────────────────────────────
window.downloadBackup = async function() {
  const data = await api('GET', '/api/projects');
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `loadboard-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded!');
};

window.restoreFromFile = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('restore-status');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.projects)) throw new Error('Invalid backup file');
    if (!confirm(`This will replace ALL current data with ${data.projects.length} projects from the backup file.\n\nAre you sure?`)) {
      input.value = '';
      return;
    }
    await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-restore-confirm': 'yes' },
      body: JSON.stringify(data)
    });
    const loaded = await api('GET', '/api/projects');
    projects = loaded.projects || [];
    teamCapacity = loaded.teamCapacity || 10;
    renderAll();
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = `✓ Restored ${projects.length} projects successfully.`;
    showToast('Data restored!');
  } catch(e) {
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = `Error: ${e.message}`;
  }
  input.value = '';
};

// ── Report export ──────────────────────────────────────────────────────────
window.exportReport = function() {
  // Ensure dashboard charts are rendered
  if (activeSection !== 'dashboard') {
    navigate('dashboard');
    setTimeout(exportReport, 350);
    return;
  }

  const dashImg     = document.getElementById('dashChart')?.toDataURL('image/png');
  const donutImg    = document.getElementById('donutChart')?.toDataURL('image/png');
  const timelineImg = document.getElementById('timelineChart')?.toDataURL('image/png');

  const now = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const [mn, mx] = getViewRange();
  const windowStr = `${idxLabel(mn)} – ${idxLabel(mx)}`;

  const rp = getFilteredProjects();
  const totalValue    = rp.reduce((s,p) => s+(parseFloat(p.value)||0), 0);
  const weightedValue = rp.reduce((s,p) => s+(parseFloat(p.value)||0)*(p.prob??100)/100, 0);
  const weighted = getMonthlyDemand(true), best = getMonthlyDemand(false);

  // Monthly resource table
  let resRows = '';
  for (let i = mn; i <= mx; i++) {
    const w = +(weighted[i]||0).toFixed(1), bc = +(best[i]||0).toFixed(1);
    const over = bc > teamCapacity;
    resRows += `<tr><td>${idxLabel(i)}</td><td style="text-align:right">${w}</td>
      <td style="text-align:right${over?';color:#9b1c1c;font-weight:600':''}">
        ${bc}${over?' ⚠':''}
      </td>
      <td style="text-align:right;color:#666">${teamCapacity}</td></tr>`;
  }

  // Gantt as HTML
  const count = mx - mn + 1;
  const inView = getProjectsInView();
  let ganttHeader = '<div style="display:flex;margin-left:180px;margin-bottom:4px;">';
  for (let i = mn; i <= mx; i++) {
    const m = i % 12, y = Math.floor(i / 12);
    const lbl = (m===0||i===mn) ? `${MONTHS[m]}<br><span style="font-size:8px;color:#999">${y}</span>` : MONTHS[m];
    ganttHeader += `<div style="flex:1;font-size:9px;color:#666;text-align:center;${m===0&&i!==mn?'border-left:1px dashed #ddd':''}">${lbl}</div>`;
  }
  ganttHeader += '</div>';
  let ganttBars = inView.map((p,pi) => {
    const s = monthToIdx(p.start), e = monthToIdx(p.end);
    if (!s||!e) return '';
    const left  = Math.max(0, (s-mn)/count*100).toFixed(1);
    const w     = Math.max(0, Math.min(100,(e-mn+1)/count*100) - parseFloat(left)).toFixed(1);
    const color = BAR_COLORS[pi % BAR_COLORS.length];
    const op    = ((p.prob??100)/100).toFixed(2);
    return `<div style="display:flex;align-items:center;margin-bottom:3px;">
      <div style="width:180px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;color:#1a1a18">${projectLabel(p)}</div>
      <div style="flex:1;background:#eef2f7;border-radius:3px;height:13px;position:relative;">
        <div style="position:absolute;left:${left}%;width:${w}%;height:100%;background:${color};border-radius:3px;opacity:${op};"></div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  // Project rows
  const projRows = rp.map(p => {
    const rm    = Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    const value = parseFloat(p.value)||0;
    const rate  = parseFloat(p.rate)||0;
    const labor = Math.round(rm*160)*rate;
    const margin = value>0&&labor>0 ? value-labor : null;
    return `<tr>
      <td>${projectLabel(p)}</td>
      <td>${p.discipline||'—'}</td>
      <td style="white-space:nowrap">${p.start||'—'} → ${p.end||'—'}</td>
      <td>${STATUS_LABEL[p.status]||p.status}</td>
      <td style="text-align:right">${p.prob??100}%</td>
      <td style="text-align:right">${rm>0?rm.toFixed(1):'—'}</td>
      <td style="text-align:right">${value>0?formatMoney(value):'—'}</td>
      <td style="text-align:right">${labor>0?formatMoney(labor):'—'}</td>
      <td style="text-align:right;${margin!=null?(margin>=0?'color:#065f46':'color:#9b1c1c'):''};font-weight:${margin!=null?'600':'400'}">${margin!=null?formatMoney(margin):'—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Engineering Loadboard — Report ${now}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f1b2d;background:#fff;padding:40px;font-size:12px;line-height:1.45}
  h1{font-size:20px;font-weight:700;color:#0f2744}
  .subtitle{color:#4a6080;font-size:11px;margin:3px 0 24px}
  h2{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1a56a0;margin:24px 0 10px;padding-bottom:5px;border-bottom:2px solid #dbeafe}
  .metrics{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
  .metric{border:1px solid #dde8f5;border-radius:8px;padding:12px 16px;flex:1;min-width:100px;background:#f8fbff}
  .metric-label{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#4a6080;margin-bottom:3px}
  .metric-value{font-size:20px;font-weight:700}
  .charts-row{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px}
  img.chart{width:100%;border:1px solid #e8eff7;border-radius:8px;display:block}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}
  th{text-align:left;padding:6px 8px;background:#f0f5fb;border-bottom:2px solid #dde8f5;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#4a6080;font-weight:700}
  td{padding:6px 8px;border-bottom:1px solid #eef2f7;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .footer{margin-top:32px;padding-top:12px;border-top:1px solid #dde8f5;font-size:10px;color:#8099b3;display:flex;justify-content:space-between}
  @media print{body{padding:20px}@page{margin:1.5cm}}
</style>
</head>
<body>
<h1>⚡ Engineering Loadboard</h1>
<div class="subtitle">Report generated ${now} · ${rp.length} project${rp.length!==1?'s':''}${filterDiscipline?' · '+filterDiscipline:''} · Window: ${windowStr}</div>

<div class="metrics">
  <div class="metric"><div class="metric-label">Total Projects</div><div class="metric-value" style="color:#1a56a0">${rp.length}</div></div>
  <div class="metric"><div class="metric-label">Active</div><div class="metric-value" style="color:#065f46">${rp.filter(p=>p.status==='active').length}</div></div>
  <div class="metric"><div class="metric-label">Peak Expected FTEs</div><div class="metric-value" style="color:#0e7490">${document.getElementById('m-peak-w').textContent}</div></div>
  <div class="metric"><div class="metric-label">Peak Best-Case FTEs</div><div class="metric-value" style="color:#1a56a0">${document.getElementById('m-peak-wc').textContent}</div></div>
  ${totalValue>0?`<div class="metric"><div class="metric-label">Portfolio Value</div><div class="metric-value" style="color:#065f46">${formatMoney(totalValue)}</div></div>`:''}
  ${weightedValue>0?`<div class="metric"><div class="metric-label">Expected Value</div><div class="metric-value" style="color:#0e7490">${formatMoney(weightedValue)}</div></div>`:''}
</div>

<h2>Resource Demand &amp; Portfolio Breakdown</h2>
<div class="charts-row">
  ${dashImg?`<img class="chart" src="${dashImg}" alt="Resource demand">`:'<p style="color:#999">Render on dashboard to capture</p>'}
  ${donutImg?`<img class="chart" src="${donutImg}" alt="Portfolio breakdown">`:''}
</div>

${timelineImg?`<h2>Project Timeline — Stacked FTE Area</h2><img class="chart" src="${timelineImg}" alt="Timeline" style="margin-bottom:12px">`:''}

<h2>Project Timeline — Gantt</h2>
${ganttHeader}${ganttBars||'<p style="color:#666;font-size:11px">No projects in view window.</p>'}

<h2>Monthly Resource Demand</h2>
<table>
  <thead><tr><th>Month</th><th style="text-align:right">Expected FTEs</th><th style="text-align:right">Best-case FTEs</th><th style="text-align:right">Team Capacity</th></tr></thead>
  <tbody>${resRows}</tbody>
</table>

<h2>Projects</h2>
<table>
  <thead><tr>
    <th>Project / Client</th><th>Discipline</th><th>Dates</th><th>Status</th>
    <th style="text-align:right">Prob</th><th style="text-align:right">Res-Mo</th>
    <th style="text-align:right">Value</th><th style="text-align:right">Est. Labor</th><th style="text-align:right">Margin</th>
  </tr></thead>
  <tbody>${projRows}</tbody>
</table>

<div class="footer">
  <span>⚡ Engineering Loadboard</span>
  <span>Exported ${now}</span>
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked — allow pop-ups for this page and try again.'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
};

// ── Modal: open / close ───────────────────────────────────────────────────
window.openAdd = function() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add project';
  document.getElementById('modal-delete').style.display = 'none';
  ['f-name','f-client','f-notes','f-value','f-margin','f-rate'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-prob').value = 100;
  document.getElementById('f-status').value = 'active';
  document.getElementById('f-discipline').value = 'Transmission';
  const now = new Date();
  const ym    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const end   = new Date(now.getFullYear(), now.getMonth()+6, 1);
  const ymEnd = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('f-start').value = ym;
  document.getElementById('f-end').value   = ymEnd;
  buildMonthInputs(ym, ymEnd, {});
  document.getElementById('planner-result').innerHTML = '<span class="planner-hint">Enter value, margin, rate + dates</span>';
  document.getElementById('planner-actions').style.display = 'none';
  document.getElementById('projectModal').classList.add('open');
};

window.openEdit = function(id) {
  const p = projects.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit project';
  document.getElementById('modal-delete').style.display = 'inline-flex';
  document.getElementById('f-name').value       = p.name       || '';
  document.getElementById('f-client').value     = p.client     || '';
  document.getElementById('f-notes').value      = p.notes      || '';
  document.getElementById('f-start').value      = p.start      || '';
  document.getElementById('f-end').value        = p.end        || '';
  document.getElementById('f-prob').value       = p.prob       ?? 100;
  document.getElementById('f-status').value     = p.status     || 'active';
  document.getElementById('f-discipline').value = p.discipline || 'Transmission';
  document.getElementById('f-value').value      = p.value      || '';
  document.getElementById('f-margin').value     = p.margin     || '';
  document.getElementById('f-rate').value       = p.rate       || '';
  buildMonthInputs(p.start, p.end, p.resources || {});
  updatePlanner();
  document.getElementById('projectModal').classList.add('open');
};

window.closeModal = function() {
  document.getElementById('projectModal').classList.remove('open');
  editingId = null;
};

// ── Month inputs ──────────────────────────────────────────────────────────
function buildMonthInputs(start, end, existing) {
  const container = document.getElementById('month-inputs');
  if (!start || !end) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Set start and end month first</div>'; return; }
  const s = monthToIdx(start), e = monthToIdx(end);
  if (s == null || e == null || s > e) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Invalid date range</div>'; return; }
  container.innerHTML = '';
  for (let i = s; i <= e; i++) {
    const ym = idxToYM(i);
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    cell.innerHTML = `<label>${idxLabel(i,true)} '${String(Math.floor(i/12)).slice(-2)}</label>
      <input type="number" min="0" step="0.5" data-ym="${ym}" value="${existing[ym]!=null?existing[ym]:''}" oninput="updatePlanner()">`;
    container.appendChild(cell);
  }
}

window.refreshMonthInputs = function() {
  const s = document.getElementById('f-start').value;
  const e = document.getElementById('f-end').value;
  const existing = {};
  document.querySelectorAll('#month-inputs input').forEach(inp => {
    if (inp.value !== '') existing[inp.dataset.ym] = parseFloat(inp.value) || 0;
  });
  buildMonthInputs(s, e, existing);
};

// ── Save / Delete ─────────────────────────────────────────────────────────
window.saveProject = async function() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Project name is required.'); return; }
  const resources = {};
  document.querySelectorAll('#month-inputs input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) resources[inp.dataset.ym] = v;
  });
  const payload = {
    name,
    client:     document.getElementById('f-client').value.trim(),
    notes:      document.getElementById('f-notes').value.trim(),
    start:      document.getElementById('f-start').value,
    end:        document.getElementById('f-end').value,
    prob:       parseInt(document.getElementById('f-prob').value) || 100,
    status:     document.getElementById('f-status').value,
    discipline: document.getElementById('f-discipline').value,
    value:      parseFloat(document.getElementById('f-value').value)  || null,
    margin:     parseFloat(document.getElementById('f-margin').value) || null,
    rate:       parseFloat(document.getElementById('f-rate').value)   || null,
    resources
  };
  try {
    if (editingId) {
      const updated = await api('PUT', `/api/projects/${editingId}`, payload);
      const idx = projects.findIndex(p => p.id === editingId);
      if (idx >= 0) projects[idx] = updated;
    } else {
      const created = await api('POST', '/api/projects', payload);
      projects.push(created);
    }
    closeModal();
    renderAll();
    toast(editingId ? 'Project updated' : 'Project added');
  } catch(e) {}
};

window.deleteProject = async function() {
  if (!editingId || !confirm('Delete this project? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/projects/${editingId}`);
    projects = projects.filter(p => p.id !== editingId);
    closeModal();
    renderAll();
    toast('Project deleted');
  } catch(e) {}
};

// ── Settings ──────────────────────────────────────────────────────────────
window.saveSettings = async function() {
  teamCapacity = parseInt(document.getElementById('capacityInput').value) || 10;
  await api('PUT', '/api/settings', { teamCapacity });
  renderAll();
  toast('Settings saved');
};

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────
document.getElementById('projectModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

loadAll();
