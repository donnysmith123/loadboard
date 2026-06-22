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

// Blue-green palette for donuts, financials, resource charts
const BAR_COLORS = [
  '#1a56a0','#0e7490','#059669','#2563eb',
  '#0d9488','#1d4ed8','#047857','#0284c7',
  '#065f46','#0f766e','#1e40af','#0369a1'
];

// High-contrast categorical palette for timeline (maximally distinct)
const TIMELINE_COLORS = [
  '#2563eb', // vivid blue
  '#dc2626', // vivid red
  '#16a34a', // vivid green
  '#ea580c', // vivid orange
  '#7c3aed', // vivid purple
  '#0891b2', // vivid cyan
  '#ca8a04', // vivid amber
  '#be185d', // vivid pink/rose
  '#0f766e', // dark teal
  '#b45309', // dark amber/brown
  '#4f46e5', // indigo
  '#15803d', // dark green
  '#c2410c', // burnt orange
  '#6d28d9', // deep violet
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
  // Keep timeline in sync regardless of which tab is active
  if (activeSection !== 'dashboard') renderTimelineChart();
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

// ── Stacked bar timeline ──────────────────────────────────────────────────

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

  // Always destroy any existing instance on the canvas (handles variable sync issues)
  const existingTimeline = Chart.getChart('timelineChart');
  if (existingTimeline) existingTimeline.destroy();
  timelineChart = null;
  if (!projectsWithData.length) return;

  // Calculate actual max stacked value to set y-axis tightly
  let maxStacked = 0;
  for (let i = mn; i <= mx; i++) {
    const ym = idxToYM(i);
    let total = 0;
    for (const p of projectsWithData) {
      total += ((p.resources || {})[ym] || 0) * (p.prob ?? 100) / 100;
    }
    maxStacked = Math.max(maxStacked, total);
  }
  const yMax = Math.ceil(Math.max(teamCapacity, maxStacked) * 1.18);

  const capData = [];
  for (let i = mn; i <= mx; i++) capData.push(teamCapacity);

  const barDatasets = projectsWithData.map((p, pi) => {
    const color = TIMELINE_COLORS[pi % TIMELINE_COLORS.length];
    const data = [];
    for (let i = mn; i <= mx; i++) {
      const ym = idxToYM(i);
      const val = ((p.resources || {})[ym] || 0) * (p.prob ?? 100) / 100;
      data.push(+val.toFixed(2));
    }
    return {
      type: 'bar',
      label: projectLabel(p),
      data,
      backgroundColor: color + 'dd',
      borderColor: color,
      borderWidth: 1,
      borderRadius: 2,
      datalabels: {
        display: ctx => ctx.parsed.y >= 0.5,
        formatter: v => v.toFixed(1),
        anchor: 'center',
        align: 'center',
        color: '#fff',
        font: { size: 9, weight: '700' },
        backgroundColor: color + 'cc',
        borderRadius: 3,
        padding: { top: 2, bottom: 2, left: 4, right: 4 },
        textStrokeColor: 'rgba(0,0,0,0.5)',
        textStrokeWidth: 2,
      }
    };
  });

  const capacityDataset = {
    type: 'line',
    label: '──── Capacity',
    data: capData,
    borderColor: '#ef4444',
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    order: -1,
    datalabels: { display: false }
  };

  timelineChart = new Chart(document.getElementById('timelineChart'), {
    data: { labels, datasets: [...barDatasets, capacityDataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 11 },
            boxWidth: 14,
            padding: 10,
            filter: item => item.text !== '──── Capacity'
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.type === 'line'
              ? ` Team capacity: ${teamCapacity} FTE`
              : ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} FTE`
          }
        },
        datalabels: {}
      },
      scales: {
        x: {
          stacked: true,
          ticks: { autoSkip: false, maxRotation: 0, font: { size: 10 } },
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: yMax,
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 11 } },
          title: { display: true, text: 'Expected FTEs', font: { size: 11 } }
        }
      }
    },
    plugins: [
    window.ChartDataLabels || {},
    {
      id: 'whiteBackground',
      beforeDraw: chart => {
        const ctx = chart.canvas.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    }
    ]
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
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f1b2d;background:#fff;font-size:11px;line-height:1.5;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .page{padding:28px 32px;max-width:100%}
  h1{font-size:22px;font-weight:800;color:#0f2744;letter-spacing:-0.3px}
  .subtitle{color:#4a6080;font-size:10px;margin:4px 0 20px;letter-spacing:0.02em}
  h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#1a56a0;margin:22px 0 10px;padding-bottom:6px;border-bottom:2px solid #dbeafe;page-break-after:avoid}
  /* Metrics */
  .metrics{display:flex;gap:8px;margin-bottom:18px;flex-wrap:nowrap}
  .metric{border:1px solid #dde8f5;border-radius:6px;padding:10px 14px;flex:1;background:#f8fbff;min-width:0}
  .metric-label{font-size:8px;text-transform:uppercase;letter-spacing:.07em;color:#4a6080;margin-bottom:2px;white-space:nowrap}
  .metric-value{font-size:18px;font-weight:800;white-space:nowrap}
  /* Charts */
  .chart-full{width:100%;display:block;border:1px solid #e8eff7;border-radius:6px;margin-bottom:4px}
  .charts-2col{display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:start;margin-bottom:4px}
  .chart-caption{font-size:9px;color:#8099b3;margin-bottom:12px}
  /* Gantt */
  .gantt-wrap{width:100%;margin-bottom:4px}
  .gantt-head{display:flex;margin-left:160px;margin-bottom:3px}
  .gantt-hlabel{flex:1;font-size:8px;color:#8099b3;text-align:center;padding:0 1px;line-height:1.3;white-space:nowrap;overflow:hidden}
  .gantt-hy{border-left:1px dashed #c7d8ed;color:#1a56a0;font-weight:700}
  .gantt-row{display:flex;align-items:center;margin-bottom:4px;min-height:18px}
  .gantt-name{width:160px;min-width:160px;font-size:9px;color:#1a1a2e;padding-right:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3}
  .gantt-track{flex:1;background:#eef2f7;border-radius:3px;height:14px;position:relative;overflow:hidden}
  .gantt-bar{height:100%;border-radius:3px;position:absolute;display:flex;align-items:center;padding:0 4px;font-size:8px;font-weight:700;color:rgba(255,255,255,0.95);white-space:nowrap;overflow:hidden}
  /* Tables */
  table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:4px;table-layout:fixed}
  th{text-align:left;padding:5px 7px;background:#f0f5fb;border-bottom:2px solid #dde8f5;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#4a6080;font-weight:700;white-space:nowrap;overflow:hidden}
  td{padding:5px 7px;border-bottom:1px solid #eef2f7;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#fafcff}
  .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .badge-green{background:#d1fae5;color:#065f46}
  .badge-teal{background:#cffafe;color:#0e7490}
  .badge-blue{background:#dbeafe;color:#1e40af}
  .badge-gray{background:#f3f4f6;color:#6b7280}
  /* Resource table */
  .res-table th:first-child,.res-table td:first-child{width:80px}
  .over{color:#9b1c1c;font-weight:700}
  /* Page breaks */
  .pb{page-break-before:always;padding-top:28px}
  .no-break{page-break-inside:avoid}
  /* Footer */
  .footer{margin-top:24px;padding-top:10px;border-top:1px solid #dde8f5;font-size:9px;color:#8099b3;display:flex;justify-content:space-between}
  @page{margin:1.2cm;size:letter landscape}
  @media print{body{font-size:10px}.page{padding:0}}
</style>
</head>
<body>
<div class="page">

<h1>⚡ Engineering Loadboard</h1>
<div class="subtitle">
  Generated ${now}${filterDiscipline?' &nbsp;·&nbsp; '+filterDiscipline+' discipline':''} &nbsp;·&nbsp; Window: ${windowStr} &nbsp;·&nbsp; ${rp.length} project${rp.length!==1?'s':''}
</div>

<div class="metrics">
  <div class="metric"><div class="metric-label">Projects</div><div class="metric-value" style="color:#1a56a0">${rp.length}</div></div>
  <div class="metric"><div class="metric-label">Active</div><div class="metric-value" style="color:#065f46">${rp.filter(p=>p.status==='active').length}</div></div>
  <div class="metric"><div class="metric-label">Peak Expected FTE</div><div class="metric-value" style="color:#0e7490">${document.getElementById('m-peak-w').textContent}</div></div>
  <div class="metric"><div class="metric-label">Peak Best-Case FTE</div><div class="metric-value" style="color:#1a56a0">${document.getElementById('m-peak-wc').textContent}</div></div>
  ${totalValue>0?`<div class="metric"><div class="metric-label">Portfolio Value</div><div class="metric-value" style="color:#065f46">${formatMoney(totalValue)}</div></div>`:''}
  ${weightedValue>0?`<div class="metric"><div class="metric-label">Expected Value</div><div class="metric-value" style="color:#0e7490">${formatMoney(weightedValue)}</div></div>`:''}
  <div class="metric"><div class="metric-label">Team Capacity</div><div class="metric-value" style="color:#374151">${teamCapacity} FTE</div></div>
</div>

<h2>Resource Demand &amp; Portfolio Value</h2>
<div class="charts-2col">
  ${dashImg?`<img class="chart-full" src="${dashImg}" alt="Resource demand">`:''}
  ${donutImg?`<img class="chart-full" src="${donutImg}" alt="Portfolio">`:''}
</div>
<div class="chart-caption">Left: Monthly FTE demand (expected vs best-case) with team capacity line &nbsp;·&nbsp; Right: Portfolio breakdown by contract value</div>

${timelineImg?`
<h2>Project Timeline — Expected FTEs by Project</h2>
<img class="chart-full" src="${timelineImg}" alt="Timeline" style="height:260px;object-fit:fill;">
<div class="chart-caption">Stacked bars = probability-weighted FTE contribution per project · Red dashed = team capacity</div>
`:''}

<h2>Project Gantt</h2>
<div class="gantt-wrap">
  <div class="gantt-head">
    ${Array.from({length: mx-mn+1}, (_,k) => {
      const m=(mn+k)%12, y=Math.floor((mn+k)/12);
      const isJan = m===0 && k>0;
      return `<div class="gantt-hlabel${isJan?' gantt-hy':''}">${isJan?String(y)+'<br>':''}`+MONTHS[m]+`</div>`;
    }).join('')}
  </div>
  ${inView.map((p,pi) => {
    const s=monthToIdx(p.start), e=monthToIdx(p.end);
    if(!s||!e) return '';
    const cnt=mx-mn+1;
    const left=Math.max(0,(s-mn)/cnt*100).toFixed(1);
    const w=Math.max(0.5,Math.min(100,(e-mn+1)/cnt*100)-parseFloat(left)).toFixed(1);
    const color=TIMELINE_COLORS[pi%TIMELINE_COLORS.length];
    const opacity=((p.prob??100)/100).toFixed(2);
    const label=projectLabel(p);
    return `<div class="gantt-row no-break">
      <div class="gantt-name" title="${label}">${label}</div>
      <div class="gantt-track">
        <div class="gantt-bar" style="left:${left}%;width:${w}%;background:${color};opacity:${opacity};">${parseFloat(w)>8?label:''}</div>
      </div>
    </div>`;
  }).filter(Boolean).join('')}
  ${!inView.length?'<p style="color:#666;font-size:10px;padding:8px 0">No projects in current view window.</p>':''}
</div>

<div class="pb">
<h2>Monthly Resource Demand</h2>
<table class="res-table" style="max-width:520px">
  <thead><tr>
    <th>Month</th>
    <th style="text-align:right">Expected FTE</th>
    <th style="text-align:right">Best-Case FTE</th>
    <th style="text-align:right">Capacity</th>
    <th style="text-align:right">Headroom</th>
  </tr></thead>
  <tbody>${Array.from({length:mx-mn+1},(_,k)=>{
    const i=mn+k;
    const w=+(weighted[i]||0).toFixed(1), bc=+(best[i]||0).toFixed(1);
    const over=bc>teamCapacity;
    const headroom=(teamCapacity-bc).toFixed(1);
    return `<tr>
      <td style="font-weight:600">${idxLabel(i)}</td>
      <td style="text-align:right">${w}</td>
      <td style="text-align:right" class="${over?'over':''}">${bc}${over?' ⚠':''}</td>
      <td style="text-align:right;color:#6b7280">${teamCapacity}</td>
      <td style="text-align:right;color:${over?'#9b1c1c':'#065f46'};font-weight:600">${over?headroom:'+'+headroom}</td>
    </tr>`;
  }).join('')}</tbody>
</table>

<h2 style="margin-top:24px">Project Details</h2>
<table>
  <thead><tr>
    <th style="width:22%">Project / Client</th>
    <th style="width:11%">Discipline</th>
    <th style="width:12%">Dates</th>
    <th style="width:8%">Status</th>
    <th style="width:5%;text-align:right">Prob</th>
    <th style="width:6%;text-align:right">Res-Mo</th>
    <th style="width:9%;text-align:right">Value</th>
    <th style="width:9%;text-align:right">Est. Labor</th>
    <th style="width:9%;text-align:right">Margin $</th>
    <th style="width:9%;text-align:right">Margin %</th>
  </tr></thead>
  <tbody>${rp.map(p=>{
    const rm=Object.values(p.resources||{}).reduce((a,b)=>a+(b||0),0);
    const value=parseFloat(p.value)||0;
    const rate=parseFloat(p.rate)||0;
    const labor=Math.round(rm*160)*rate;
    const marginDol=value>0&&labor>0?value-labor:null;
    const marginPct=p.margin!=null?parseFloat(p.margin):null;
    const mColor=marginDol!=null?(marginDol>=0?'#065f46':'#9b1c1c'):'';
    const badge={active:'badge-green',probable:'badge-teal',bid:'badge-blue','on-hold':'badge-gray',completed:'badge-gray'}[p.status]||'badge-gray';
    return `<tr>
      <td style="font-weight:600">${p.name}${p.client?`<span style="display:block;font-weight:400;color:#4a6080;font-size:9px">${p.client}</span>`:''}
      </td>
      <td>${p.discipline||'—'}</td>
      <td style="font-size:9px">${p.start||'—'}<br>${p.end||'—'}</td>
      <td><span class="badge ${badge}">${STATUS_LABEL[p.status]||p.status}</span></td>
      <td style="text-align:right">${p.prob??100}%</td>
      <td style="text-align:right">${rm>0?rm.toFixed(1):'—'}</td>
      <td style="text-align:right">${value>0?formatMoney(value):'—'}</td>
      <td style="text-align:right">${labor>0?formatMoney(labor):'—'}</td>
      <td style="text-align:right;font-weight:600;color:${mColor}">${marginDol!=null?formatMoney(marginDol):'—'}</td>
      <td style="text-align:right;color:${mColor}">${marginPct!=null?marginPct+'%':'—'}</td>
    </tr>`;
  }).join('')}</tbody>
</table>
</div>

<div class="footer">
  <span>⚡ Engineering Loadboard &nbsp;·&nbsp; Engineering Resource Management</span>
  <span>Exported ${now}</span>
</div>

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
