import { api, session } from '../api.js';
import {
  appointmentTable, consultationTimeline, missingFieldsCallout, openBookingModal, openPatientForm,
  patientBanner, patientDetailsHtml,
} from '../components.js';
import { $, $$, age, emptyState, esc, fmtDate, fmtDateTime, icon, initials, loading, pid } from '../ui.js';

// ------------------------------------------------------------------ list
export async function patientsView(root) {
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Patients</h1><p class="muted" data-count>Loading…</p></div>
      <button class="btn primary" data-add>${icon('plus')} Register patient</button>
    </div>
    <div class="card">
      <div class="card-head"><div class="search" style="flex:1;max-width:420px">${icon('search')}<input data-q placeholder="Search by name, email or phone"></div></div>
      <div class="card-body flush" data-list>${loading()}</div>
    </div>`;
  const list = $('[data-list]', root);
  let timer;

  async function load() {
    const q = $('[data-q]', root).value.trim();
    const patients = await api('/patients', { query: { q } });
    $('[data-count]', root).textContent = q ? `${patients.length} matching “${q}”` : `${patients.length} registered patients`;
    if (!patients.length) { list.innerHTML = emptyState('No patients found', 'users'); return; }
    list.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Patient</th><th>Contact</th><th>Age / gender</th><th>Blood</th><th>Allergies</th><th>Record</th></tr></thead>
      <tbody>${patients.map(p => `<tr class="clickable" data-id="${p.id}">
        <td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(p.name))}</span>
          <div><b>${esc(p.name)}</b><span class="sub">${pid(p.id)}</span></div></div></td>
        <td>${esc(p.email)}<span class="sub">${esc(p.phone || '—')}</span></td>
        <td>${age(p.date_of_birth) ?? '—'}${p.gender ? ' · ' + esc(p.gender) : ''}</td>
        <td>${esc(p.blood_type || '—')}</td>
        <td>${p.allergies && !/^none$/i.test(p.allergies) ? `<span class="tag alert">${esc(p.allergies)}</span>` : '<span class="muted">None</span>'}</td>
        <td>${p.missing_fields.length ? `<span class="tag" title="Missing: ${esc(p.missing_fields.join(', '))}">${p.missing_fields.length} missing</span>` : '<span class="pill completed">Complete</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('[data-id]', list).forEach(r => r.addEventListener('click', () => { location.hash = `#/patients/${r.dataset.id}`; }));
  }

  $('[data-q]', root).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  $('[data-add]', root).addEventListener('click', async () => {
    const p = await openPatientForm();
    if (p) location.hash = `#/patients/${p.id}`;
  });
  await load();
}

// ------------------------------------------------------------------ detail
export async function patientDetailView(root, { id }) {
  const [p, appts, consults, history] = await Promise.all([
    api(`/patients/${id}`),
    api('/appointments', { query: { patient_id: id } }),
    api('/consultations', { query: { patient_id: id } }),
    api(`/patients/${id}/history`),
  ]);
  const role = session.user.role;
  const upcoming = appts.filter(a => a.status === 'BOOKED' && new Date(a.slot) > new Date());
  const consultable = role === 'DOCTOR' && appts.find(a => a.doctor_id === session.user.doctor_id && a.status === 'BOOKED' && !a.has_consultation);

  root.innerHTML = `
    <div class="row" style="margin-bottom:14px"><a href="#/patients" class="btn ghost sm">${icon('chevronLeft')} All patients</a></div>
    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div class="row between" style="align-items:flex-start;gap:16px">
        <div style="flex:1;min-width:260px">${patientBanner(p)}</div>
        <div class="row">
          ${consultable ? `<a class="btn primary" href="#/consult/${consultable.id}">${icon('stethoscope')} Start consultation</a>` : ''}
          <button class="btn" data-book>${icon('calendar')} Book appointment</button>
          <button class="btn" data-edit>${icon('edit')} Edit record</button>
        </div>
      </div>
      ${p.missing_fields.length ? `<div style="margin-top:16px">${missingFieldsCallout(p)}</div>` : ''}
    </div></div>
    <div class="tabs" role="tablist">
      <button class="active" data-tab="profile">Profile</button>
      <button data-tab="consults">Consultations & prescriptions (${consults.length})</button>
      <button data-tab="appts">Appointments (${appts.length})</button>
      <button data-tab="history">Change history (${history.length})</button>
    </div>
    <div data-pane="profile" class="split">
      <div class="card"><div class="card-head"><h2>Health record</h2></div><div class="card-body">${patientDetailsHtml(p)}</div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Upcoming appointments</h2></div><div class="card-body flush">
          ${upcoming.length ? `<div class="list">${upcoming.map(a => `<div class="list-item">
            <div class="date-badge"><small>${esc(fmtDate(a.slot, { month: 'short' }))}</small><b>${new Date(a.slot).getDate()}</b></div>
            <div class="grow"><b>${esc(a.doctor_name)}</b><div class="muted small">${esc(fmtDateTime(a.slot))} · ${esc(a.reason || 'General visit')}</div></div></div>`).join('')}</div>`
            : emptyState('Nothing scheduled', 'calendar')}</div></div>
        <div class="card"><div class="card-head"><h2>Latest consultation</h2></div><div class="card-body flush" data-latest></div></div>
      </div>
    </div>
    <div data-pane="consults" class="card hidden"><div class="card-body flush" data-consults></div></div>
    <div data-pane="appts" class="card hidden"><div class="card-body flush" data-appts></div></div>
    <div data-pane="history" class="card hidden"><div class="card-body flush">${historyHtml(history)}</div></div>`;

  consultationTimeline($('[data-latest]', root), consults.slice(0, 1));
  consultationTimeline($('[data-consults]', root), consults);
  appointmentTable($('[data-appts]', root), appts.slice().reverse(), { columns: ['doctor'], onChange: () => patientDetailView(root, { id }) });

  $$('[data-tab]', root).forEach(b => b.addEventListener('click', () => {
    $$('[data-tab]', root).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', root).forEach(x => x.classList.toggle('hidden', x.dataset.pane !== b.dataset.tab));
  }));
  $('[data-edit]', root).addEventListener('click', async () => { if (await openPatientForm(p)) patientDetailView(root, { id }); });
  $('[data-book]', root).addEventListener('click', async () => { if (await openBookingModal({ patientId: p.id })) patientDetailView(root, { id }); });
}

const FIELD_LABELS = {
  name: 'Name', email: 'Email', phone: 'Phone', date_of_birth: 'Date of birth', gender: 'Gender', blood_type: 'Blood type',
  allergies: 'Allergies', medical_history: 'Medical history', chronic_conditions: 'Chronic conditions',
  current_medications: 'Current medications', address: 'Address', emergency_contact_name: 'Emergency contact',
  emergency_contact_phone: 'Emergency phone', insurance_provider: 'Insurance provider', insurance_number: 'Policy number',
};

export function historyHtml(history) {
  if (!history.length) return emptyState('No changes since registration', 'clock');
  return `<div class="timeline">${history.map(h => `
    <div class="tl-item">
      <div class="tl-date"><b>${esc(fmtDate(h.changed_at, { day: 'numeric', month: 'short' }))}</b>${esc(fmtDateTime(h.changed_at).split(', ').pop())}</div>
      <div><p class="small muted" style="margin-bottom:6px">Changed by ${esc(h.changed_by || 'unknown')}</p>
        <div class="table-wrap"><table><thead><tr><th>Field</th><th>Previous</th><th>New</th></tr></thead><tbody>
        ${Object.entries(h.changes).map(([f, [o, n]]) => `<tr><td>${esc(FIELD_LABELS[f] || f)}</td>
          <td class="muted" style="text-decoration:line-through">${esc(o ?? '—')}</td><td>${esc(n ?? '—')}</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>`).join('')}</div>`;
}
