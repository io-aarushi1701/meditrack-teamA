import { api, session } from '../api.js';
import {
  appointmentTable, bookingFlow, cancelAppointment, consultationTimeline, missingFieldsCallout, openPatientForm,
  openReschedule, patientDetailsHtml, rxLine,
} from '../components.js';
import { $, $$, emptyState, esc, fmtDate, fmtDateTime, icon } from '../ui.js';
import { historyHtml } from './patients.js';

// ------------------------------------------------------------------ home
export async function homeView(root) {
  const id = session.user.patient_id;
  const [p, appts, consults] = await Promise.all([
    api(`/patients/${id}`), api('/appointments'), api('/consultations'),
  ]);
  const now = new Date();
  const upcoming = appts.filter(a => a.status === 'BOOKED' && new Date(a.slot) > now);
  const next = upcoming[0];
  const latest = consults[0];
  const firstName = p.name.split(' ')[0];

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Hello, ${esc(firstName)}</h1><p class="muted">Here's an overview of your care.</p></div>
      <a class="btn primary" href="#/book">${icon('plus')} Book appointment</a>
    </div>
    ${p.missing_fields.length ? `<div style="margin-bottom:16px">${missingFieldsCallout(p, { self: true, link: '#/profile' })}</div>` : ''}
    <div class="grid grid-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h2>Next appointment</h2></div><div class="card-body" data-next>
        ${next ? `
          <div class="row" style="gap:14px;align-items:flex-start">
            <div class="date-badge" style="width:58px"><small>${esc(fmtDate(next.slot, { month: 'short' }))}</small><b style="font-size:22px">${new Date(next.slot).getDate()}</b></div>
            <div style="flex:1">
              <h3 style="font-size:16px">${esc(next.doctor_name)}</h3>
              <p class="muted">${esc(next.specialty || '')} · ${esc(fmtDateTime(next.slot))}</p>
              <p class="small" style="margin-top:4px">${esc(next.reason || 'General visit')}</p>
              <div class="row" style="margin-top:12px"><button class="btn sm" data-move>Reschedule</button><button class="btn sm danger" data-cancel>Cancel</button></div>
            </div>
          </div>` : emptyState('No upcoming appointments', 'calendar')}
      </div></div>
      <div class="card"><div class="card-head"><h2>Latest prescription</h2>${latest ? `<a class="btn sm" href="#/prescription/${latest.id}">${icon('file')} View</a>` : ''}</div>
        <div class="card-body">${latest ? `
          <h3>${esc(latest.diagnosis || 'Consultation')}</h3>
          <p class="muted small">${esc(latest.doctor_name)} · ${esc(fmtDate(latest.slot))}</p>
          ${latest.items.length ? `<ul class="rx-list">${latest.items.map(i => `<li>${rxLine(i)}</li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:8px">No medication prescribed.</p>'}`
          : emptyState('No prescriptions yet', 'pill')}</div></div>
    </div>
    <div class="stats">
      <div class="card stat"><div class="label">Upcoming</div><div class="value">${upcoming.length}</div><div class="hint">appointments booked</div></div>
      <div class="card stat"><div class="label">Visits</div><div class="value">${appts.filter(a => a.status === 'COMPLETED').length}</div><div class="hint">completed consultations</div></div>
      <div class="card stat"><div class="label">Blood type</div><div class="value">${esc(p.blood_type || '—')}</div><div class="hint">from your profile</div></div>
      <div class="card stat"><div class="label">Allergies</div><div class="value" style="font-size:17px;padding-top:6px">${esc(p.allergies || 'Not recorded')}</div></div>
    </div>`;

  if (next) {
    $('[data-move]', root).addEventListener('click', async () => { if (await openReschedule(next)) homeView(root); });
    $('[data-cancel]', root).addEventListener('click', async () => { if (await cancelAppointment(next)) homeView(root); });
  }
}

// ------------------------------------------------------------------ book
export async function bookView(root) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Book an appointment</h1><p class="muted">Find a doctor and pick a time that suits you.</p></div></div>
    <div class="card"><div class="card-body" data-flow></div></div>`;
  await bookingFlow($('[data-flow]', root), {
    patientId: session.user.patient_id,
    onBooked: () => { location.hash = '#/my-appointments'; },
  });
}

// ------------------------------------------------------------------ my appointments
export async function myAppointmentsView(root) {
  const appts = await api('/appointments');
  const now = new Date();
  const upcoming = appts.filter(a => new Date(a.slot) > now && a.status === 'BOOKED');
  const past = appts.filter(a => !upcoming.includes(a)).reverse();
  root.innerHTML = `
    <div class="page-head">
      <div><h1>My appointments</h1><p class="muted">${upcoming.length} upcoming · ${past.length} past</p></div>
      <a class="btn primary" href="#/book">${icon('plus')} Book appointment</a>
    </div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Upcoming</h2></div><div class="card-body flush" data-up></div></div>
      <div class="card"><div class="card-head"><h2>Past & cancelled</h2></div><div class="card-body flush" data-past></div></div>
    </div>`;
  const reload = () => myAppointmentsView(root);
  appointmentTable($('[data-up]', root), upcoming, { columns: ['doctor'], onChange: reload, empty: 'No upcoming appointments' });
  appointmentTable($('[data-past]', root), past, { columns: ['doctor'], onChange: reload, empty: 'No past appointments' });
}

// ------------------------------------------------------------------ health history
export async function historyView(root) {
  const consults = await api('/consultations');
  const meds = consults.flatMap(c => c.items.map(i => ({ ...i, date: c.slot, doctor: c.doctor_name })));
  root.innerHTML = `
    <div class="page-head"><div><h1>Health history</h1><p class="muted">Your consultations, diagnoses and prescriptions.</p></div></div>
    <div class="tabs"><button class="active" data-tab="visits">Consultations (${consults.length})</button><button data-tab="meds">All prescribed medication (${meds.length})</button></div>
    <div class="card" data-pane="visits"><div class="card-body flush" data-visits></div></div>
    <div class="card hidden" data-pane="meds"><div class="card-body flush">${meds.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Prescribed by</th></tr></thead>
      <tbody>${meds.map(m => `<tr><td class="mono">${esc(fmtDate(m.date))}</td><td><b>${esc(m.medication)}</b>${m.instructions ? `<span class="sub">${esc(m.instructions)}</span>` : ''}</td>
        <td>${esc(m.dosage || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.duration || '—')}</td><td>${esc(m.doctor)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No medication prescribed yet', 'pill')}</div></div>`;
  consultationTimeline($('[data-visits]', root), consults);
  $$('[data-tab]', root).forEach(b => b.addEventListener('click', () => {
    $$('[data-tab]', root).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', root).forEach(x => x.classList.toggle('hidden', x.dataset.pane !== b.dataset.tab));
  }));
}

// ------------------------------------------------------------------ profile
export async function profileView(root) {
  const id = session.user.patient_id;
  const [p, history] = await Promise.all([api(`/patients/${id}`), api(`/patients/${id}/history`)]);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>My profile</h1><p class="muted">Keep your details up to date so your doctors have what they need.</p></div>
      <button class="btn primary" data-edit>${icon('edit')} Edit profile</button>
    </div>
    ${p.missing_fields.length ? `<div style="margin-bottom:16px">${missingFieldsCallout(p, { self: true })}</div>` : ''}
    <div class="split">
      <div class="card"><div class="card-head"><div><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.email)}</p></div></div>
        <div class="card-body">${patientDetailsHtml(p)}</div></div>
      <div class="card"><div class="card-head"><h2>Change history</h2></div><div class="card-body flush">${historyHtml(history)}</div></div>
    </div>`;
  $('[data-edit]', root).addEventListener('click', async () => {
    const saved = await openPatientForm(p);
    if (saved) {
      if (saved.email !== session.user.email || saved.name !== session.user.name) {
        session.set(session.token, { ...session.user, email: saved.email, name: saved.name });
        window.dispatchEvent(new Event('meditrack:user'));
      }
      profileView(root);
    }
  });
}
