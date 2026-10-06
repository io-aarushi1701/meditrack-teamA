import { api, download } from '../api.js';
import { columns, hbars, stackedColumns } from '../charts.js';
import { appointmentTable } from '../components.js';
import { $, $$, busy, emptyState, esc, fmtDateTime, formData, icon, initials, isoDay, modal, toast } from '../ui.js';

// ------------------------------------------------------------------ dashboard
export async function dashboardView(root) {
  const today = isoDay(new Date());
  const [s, todays] = await Promise.all([
    api('/stats'),
    api('/appointments', { query: { date_from: today, date_to: today } }),
  ]);
  const monthKeys = Object.keys(s.trend);
  const monthLabels = monthKeys.map(k => new Date(k + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' }));
  const completionRate = (() => {
    const done = s.by_status.COMPLETED || 0, missed = s.by_status.NO_SHOW || 0;
    return done + missed ? Math.round((done / (done + missed)) * 100) : 0;
  })();

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><p class="muted">Clinic activity at a glance.</p></div>
      <div class="row">
        <span class="muted small">Export CSV:</span>
        ${['patients', 'appointments', 'consultations'].map(k => `<button class="btn sm" data-export="${k}">${icon('download')} ${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="stats">
      ${[
        ['Patients', s.patients, `+${s.new_patients_30d} in last 30 days`],
        ['Doctors', s.doctors, `${Object.keys(s.by_specialty).length} specialties`],
        ["Today's appointments", s.today, 'excluding cancelled'],
        ['Upcoming', s.upcoming, 'booked, not yet seen'],
        ['Consultations', s.consultations, 'recorded to date'],
        ['Attendance', completionRate + '%', 'completed vs no-show'],
      ].map(([l, v, h]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join('')}
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);margin-bottom:16px" data-row1>
      <div class="card"><div class="card-head"><div><h2>Monthly appointments</h2><p class="muted small">Last 6 months by outcome</p></div></div>
        <div class="card-body" data-trend></div></div>
      <div class="card"><div class="card-head"><div><h2>Appointments by specialty</h2><p class="muted small">All time</p></div></div>
        <div class="card-body" data-spec></div></div>
    </div>
    <div class="grid grid-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><div><h2>Patients by age group</h2><p class="muted small">Registered patients</p></div></div>
        <div class="card-body" data-ages></div></div>
      <div class="card"><div class="card-head"><div><h2>Patients by gender</h2><p class="muted small">Registered patients</p></div></div>
        <div class="card-body" data-gender></div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Doctor performance</h2><p class="muted small">Appointments handled per doctor</p></div></div>
      <div class="card-body flush table-wrap"><table>
        <thead><tr><th>Doctor</th><th>Specialty</th><th class="num">Appointments</th><th class="num">Completed</th><th class="num">Unique patients</th><th class="num">No-shows</th><th class="num">Upcoming</th></tr></thead>
        <tbody>${s.doctor_report.map(d => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(d.name))}</span>${esc(d.name)}</div></td>
          <td>${esc(d.specialty)}</td><td class="num">${d.appointments}</td><td class="num">${d.completed}</td><td class="num">${d.patients}</td>
          <td class="num">${d.no_shows}</td><td class="num">${d.upcoming}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-head"><div><h2>Today's schedule</h2><p class="muted small">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      <a class="btn sm" href="#/appointments">All appointments</a></div>
      <div class="card-body flush" data-today></div></div>`;

  const row1 = $('[data-row1]', root);
  if (window.matchMedia('(max-width: 1024px)').matches) row1.style.gridTemplateColumns = '1fr';

  stackedColumns($('[data-trend]', root), {
    categories: monthLabels,
    series: [
      { label: 'Completed', color: 'var(--series-1)', values: monthKeys.map(k => s.trend[k].COMPLETED) },
      { label: 'Booked', color: 'var(--series-2)', values: monthKeys.map(k => s.trend[k].BOOKED) },
      { label: 'Cancelled', color: 'var(--series-3)', values: monthKeys.map(k => s.trend[k].CANCELLED) },
      { label: 'No-show', color: 'var(--series-4)', values: monthKeys.map(k => s.trend[k].NO_SHOW) },
    ],
  });
  hbars($('[data-spec]', root), Object.entries(s.by_specialty).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })));
  columns($('[data-ages]', root), { categories: Object.keys(s.ages), values: Object.values(s.ages), label: 'Patients' });
  hbars($('[data-gender]', root), Object.entries(s.gender).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })));
  appointmentTable($('[data-today]', root), todays, { empty: 'No appointments today', onChange: () => dashboardView(root) });

  $$('[data-export]', root).forEach(b => b.addEventListener('click', () => busy(b, async () => {
    try {
      await download(`/export/${b.dataset.export}`, `meditrack-${b.dataset.export}-${isoDay(new Date())}.csv`);
      toast('Export downloaded');
    } catch (err) { toast(err.message, 'error'); }
  })));
}

// ------------------------------------------------------------------ doctors
export async function doctorsView(root) {
  const doctors = await api('/doctors');
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Doctors</h1><p class="muted">${doctors.length} doctors on staff.</p></div>
      <button class="btn primary" data-add>${icon('plus')} Add doctor</button>
    </div>
    <div class="card"><div class="card-body flush table-wrap">${doctors.length ? `<table>
      <thead><tr><th>Doctor</th><th>Specialty</th><th>Email</th><th></th></tr></thead>
      <tbody>${doctors.map(d => `<tr>
        <td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(d.name))}</span><b>${esc(d.name)}</b></div></td>
        <td>${esc(d.specialty)}</td><td>${esc(d.email || '—')}</td>
        <td class="num"><a class="btn sm" href="#/appointments?doctor=${d.id}">Appointments</a></td></tr>`).join('')}</tbody></table>`
      : emptyState('No doctors yet', 'stethoscope')}</div></div>`;

  $('[data-add]', root).addEventListener('click', () => {
    const form = document.createElement('form');
    form.innerHTML = `<div class="form-grid">
        <label class="field full">Full name <span class="req">*</span><input name="name" required minlength="2" placeholder="Dr. Jane Smith"></label>
        <label class="field">Specialty <span class="req">*</span><input name="specialty" required list="specs" placeholder="Cardiology">
          <datalist id="specs">${[...new Set(doctors.map(d => d.specialty))].map(s => `<option>${esc(s)}</option>`).join('')}</datalist></label>
        <label class="field">Email<input name="email" type="email"></label>
        <label class="field full">Login password <span class="muted">(optional — lets the doctor sign in)</span><input name="password" type="password" minlength="6"></label>
      </div>
      <div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Add doctor</button></div>`;
    const m = modal({ title: 'Add doctor', body: form });
    form.querySelector('[data-close]').addEventListener('click', m.close);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await busy($('[type=submit]', form), async () => {
        try {
          const data = formData(form);
          const d = await api('/doctors', { method: 'POST', body: data });
          toast(`${d.name} added`);
          m.close();
          doctorsView(root);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
}

// ------------------------------------------------------------------ audit log
export async function auditView(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Audit log</h1><p class="muted">Every sign-in, record access and change, newest first.</p></div>
      <div class="search" style="width:260px">${icon('search')}<input data-q placeholder="Filter by action, e.g. LOGIN"></div>
    </div>
    <div class="card"><div class="card-body flush" data-list></div></div>`;
  const list = $('[data-list]', root);
  let timer;
  async function load() {
    const rows = await api('/audit', { query: { action: $('[data-q]', root).value.trim().toUpperCase(), limit: 300 } });
    list.innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="mono" style="white-space:nowrap">${esc(fmtDateTime(r.created_at))}</td>
        <td>${esc(r.user_email || '—')}</td>
        <td><span class="tag ${r.action.includes('FAILED') ? 'alert' : ''}">${esc(r.action)}</span></td>
        <td class="mono">${r.entity ? esc(r.entity) + (r.entity_id ? ' #' + r.entity_id : '') : '—'}</td>
        <td style="max-width:320px">${esc(r.details || '')}</td>
        <td class="mono muted">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No matching entries', 'shield');
  }
  $('[data-q]', root).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  await load();
}
