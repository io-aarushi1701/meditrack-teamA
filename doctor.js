import { api, session } from '../api.js';
import {
  cancelAppointment, consultationTimeline, openReschedule, patientBanner, slotPicker,
} from '../components.js';
import {
  $, $$, busy, emptyState, esc, fmtDate, fmtDateTime, fmtTime, formData, icon, isoDay, modal, statusPill, toast,
} from '../ui.js';

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16];

function mondayOf(d) {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  const day = m.getDay();
  // on weekends the clinic is closed, so show the coming week
  m.setDate(m.getDate() + (day === 0 ? 1 : day === 6 ? 2 : 1 - day));
  return m;
}

// ------------------------------------------------------------------ schedule
export async function scheduleView(root) {
  let monday = mondayOf(new Date());
  const today = isoDay(new Date());

  root.innerHTML = `
    <div class="page-head">
      <div><h1>My schedule</h1><p class="muted">${esc(session.user.name)} · weekly calendar</p></div>
    </div>
    <div class="stats" data-stats></div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>Today's queue</h2><p class="muted small">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div></div>
      <div class="card-body flush" data-today></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="row">
          <button class="icon-btn" data-prev aria-label="Previous week">${icon('chevronLeft')}</button>
          <button class="btn sm" data-this>Current week</button>
          <button class="icon-btn" data-next aria-label="Next week">${icon('chevronRight')}</button>
          <h2 data-range style="margin-left:6px"></h2>
        </div>
        <div class="legend" style="margin:0">
          <span>${statusPill('BOOKED')}</span><span>${statusPill('COMPLETED')}</span><span>${statusPill('NO_SHOW')}</span>
        </div>
      </div>
      <div class="card-body flush table-wrap" data-cal></div>
    </div>`;

  async function loadSummary() {
    const [todays, pending, upcoming] = await Promise.all([
      api('/appointments', { query: { date_from: today, date_to: today } }),
      api('/appointments', { query: { status: 'NO_SHOW' } }),
      api('/appointments', { query: { status: 'BOOKED', date_from: today } }),
    ]);
    const active = todays.filter(a => a.status !== 'CANCELLED');
    $('[data-stats]', root).innerHTML = [
      ['Today', active.length, `${active.filter(a => a.status === 'COMPLETED').length} seen`],
      ['Upcoming', upcoming.length, 'booked from today'],
      ['Missed', pending.filter(a => !a.has_consultation).length, 'no-shows to follow up'],
    ].map(([l, v, h]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join('');

    const todayEl = $('[data-today]', root);
    todayEl.innerHTML = active.length ? `<div class="list">${active.map(a => `
      <div class="list-item">
        <div class="mono" style="width:56px;font-weight:600">${esc(fmtTime(a.slot))}</div>
        <div class="grow"><b><a href="#/patients/${a.patient_id}">${esc(a.patient_name)}</a></b><div class="muted small">${esc(a.reason || 'General visit')}</div></div>
        ${statusPill(a.status)}
        ${['BOOKED', 'NO_SHOW'].includes(a.status) && !a.has_consultation
          ? `<a class="btn sm primary" href="#/consult/${a.id}">${icon('stethoscope')} Consult</a>`
          : a.has_consultation ? `<button class="btn sm" data-rx="${a.id}">${icon('file')} Record</button>` : ''}
      </div>`).join('')}</div>` : emptyState('No patients scheduled today', 'calendar');
    $$('[data-rx]', todayEl).forEach(b => b.addEventListener('click', () => openRecord(+b.dataset.rx)));
  }

  async function loadWeek() {
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    $('[data-range]', root).textContent = `${fmtDate(monday, { day: 'numeric', month: 'short' })} – ${fmtDate(friday, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const appts = (await api('/appointments', { query: { date_from: isoDay(monday), date_to: isoDay(friday) } }))
      .filter(a => a.status !== 'CANCELLED');
    const days = [0, 1, 2, 3, 4].map(i => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
    const key = (d, h) => `${isoDay(d)}-${h}`;
    const byCell = {};
    appts.forEach(a => { const d = new Date(a.slot); byCell[key(d, d.getHours())] = a; });

    $('[data-cal]', root).innerHTML = `<div class="calendar">
      <div class="cal-head"></div>
      ${days.map(d => `<div class="cal-head ${isoDay(d) === today ? 'today' : ''}">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))} ${d.getDate()}</div>`).join('')}
      ${HOURS.map(h => `<div class="cal-time">${String(h).padStart(2, '0')}:00</div>${days.map(d => {
        const a = byCell[key(d, h)];
        return `<div class="cal-cell ${isoDay(d) === today ? 'today' : ''}">${a ? `
          <button class="cal-appt ${a.status.toLowerCase()}" data-appt="${a.id}">
            <b>${esc(a.patient_name)}</b><span>${esc(a.reason || 'General visit')}</span></button>` : ''}</div>`;
      }).join('')}`).join('')}
    </div>`;
    $$('[data-appt]', root).forEach(b => b.addEventListener('click', () => openAppointment(appts.find(a => a.id === +b.dataset.appt))));
  }

  async function openRecord(appointmentId) {
    const [c] = await api('/consultations', { query: { appointment_id: appointmentId } });
    if (c) location.hash = `#/prescription/${c.id}`;
  }

  function openAppointment(a) {
    const upcoming = a.status === 'BOOKED' && new Date(a.slot) > new Date();
    const canConsult = ['BOOKED', 'NO_SHOW'].includes(a.status) && !a.has_consultation;
    const m = modal({
      title: a.patient_name,
      body: `<dl class="kv">
          <div><dt>When</dt><dd>${esc(fmtDateTime(a.slot))}</dd></div>
          <div><dt>Status</dt><dd>${statusPill(a.status)}</dd></div>
          <div style="grid-column:1/-1"><dt>Reason</dt><dd>${esc(a.reason || '—')}</dd></div>
        </dl>`,
      footer: `
        <a class="btn" href="#/patients/${a.patient_id}">${icon('user')} Patient record</a>
        ${upcoming ? '<button class="btn" data-move>Reschedule</button><button class="btn danger" data-cancel>Cancel</button>' : ''}
        ${a.has_consultation ? `<button class="btn primary" data-rx>${icon('file')} Consultation record</button>` : ''}
        ${canConsult ? `<a class="btn primary" href="#/consult/${a.id}">${icon('stethoscope')} Start consultation</a>` : ''}`,
    });
    $$('a', m.el).forEach(x => x.addEventListener('click', m.close));
    const refresh = () => { loadWeek(); loadSummary(); };
    $('[data-move]', m.el)?.addEventListener('click', async () => { m.close(); if (await openReschedule(a)) refresh(); });
    $('[data-cancel]', m.el)?.addEventListener('click', async () => { m.close(); if (await cancelAppointment(a)) refresh(); });
    $('[data-rx]', m.el)?.addEventListener('click', () => { m.close(); openRecord(a.id); });
  }

  $('[data-prev]', root).addEventListener('click', () => { monday.setDate(monday.getDate() - 7); loadWeek(); });
  $('[data-next]', root).addEventListener('click', () => { monday.setDate(monday.getDate() + 7); loadWeek(); });
  $('[data-this]', root).addEventListener('click', () => { monday = mondayOf(new Date()); loadWeek(); });
  await Promise.all([loadSummary(), loadWeek()]);
}

// ------------------------------------------------------------------ consultation
function itemRow(i = {}) {
  return `<tr>
    <td><input name="medication" value="${esc(i.medication || '')}" placeholder="e.g. Amoxicillin" maxlength="120"></td>
    <td><input name="dosage" value="${esc(i.dosage || '')}" placeholder="500mg" maxlength="60"></td>
    <td><input name="frequency" value="${esc(i.frequency || '')}" placeholder="Twice daily" maxlength="60" list="freqs"></td>
    <td><input name="duration" value="${esc(i.duration || '')}" placeholder="7 days" maxlength="60"></td>
    <td><input name="instructions" value="${esc(i.instructions || '')}" placeholder="After food" maxlength="255"></td>
    <td><button type="button" class="icon-btn" data-remove aria-label="Remove medication">${icon('trash')}</button></td>
  </tr>`;
}

export async function consultView(root, { id }) {
  const appt = await api(`/appointments/${id}`);
  const [patient, history, existingList] = await Promise.all([
    api(`/patients/${appt.patient_id}`),
    api('/consultations', { query: { patient_id: appt.patient_id } }),
    appt.has_consultation ? api('/consultations', { query: { appointment_id: appt.id } }) : Promise.resolve([]),
  ]);
  const existing = existingList[0] || null;
  const previous = history.filter(c => c.appointment_id !== appt.id);
  const v = f => esc(existing?.[f] || '');

  root.innerHTML = `
    <div class="row" style="margin-bottom:14px"><a href="#/schedule" class="btn ghost sm">${icon('chevronLeft')} Back to schedule</a></div>
    <div class="page-head">
      <div><h1>${existing ? 'Edit consultation' : 'Consultation'}</h1>
        <p class="muted">${esc(fmtDateTime(appt.slot))} · ${esc(appt.reason || 'General visit')}</p></div>
    </div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)">
      <div class="stack">
        <div class="card"><div class="card-body">${patientBanner(patient)}
          <dl class="kv" style="margin-top:16px;grid-template-columns:1fr">
            <div><dt>Current medications</dt><dd>${esc(patient.current_medications || '—')}</dd></div>
            <div><dt>Medical history</dt><dd>${esc(patient.medical_history || '—')}</dd></div>
          </dl>
          <a class="btn sm" style="margin-top:14px" href="#/patients/${patient.id}">${icon('user')} Full record</a>
        </div></div>
        <div class="card"><div class="card-head"><h2>Previous consultations (${previous.length})</h2></div><div class="card-body flush scroll-y" data-prev></div></div>
      </div>
      <form class="card" data-form>
        <div class="card-body">
          <div class="form-section"><h3>Assessment</h3><div class="form-grid">
            <label class="field full">Symptoms<textarea name="symptoms" rows="2" placeholder="Presenting complaints">${v('symptoms') || esc(appt.reason || '')}</textarea></label>
            <label class="field full">Diagnosis <span class="req">*</span><input name="diagnosis" required value="${v('diagnosis')}" placeholder="e.g. Acute bronchitis"></label>
            <label class="field full">Observations & notes<textarea name="notes" rows="3" placeholder="Vitals, examination findings, treatment plan">${v('notes')}</textarea></label>
            <label class="field full">Lab results<textarea name="lab_results" rows="2" placeholder="e.g. HbA1c 7.2%, CBC normal">${v('lab_results')}</textarea></label>
          </div></div>
          <div class="form-section">
            <div class="row between" style="margin-bottom:10px"><h3>Prescription</h3>
              <button type="button" class="btn sm" data-add-item>${icon('plus')} Add medication</button></div>
            <datalist id="freqs"><option>Once daily</option><option>Twice daily</option><option>Three times daily</option><option>At night</option><option>Every 6 hours</option><option>As needed</option></datalist>
            <div class="table-wrap"><table class="rx-table">
              <thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th><th></th></tr></thead>
              <tbody data-items>${(existing?.items.length ? existing.items : [{}]).map(itemRow).join('')}</tbody>
            </table></div>
            <label class="field" style="margin-top:14px">Advice / instructions<textarea name="prescription" rows="2" placeholder="Diet, rest, when to come back">${v('prescription')}</textarea></label>
          </div>
          ${existing ? '' : `<div class="form-section">
            <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" data-fu style="width:auto"> <b>Book a follow-up appointment</b></label>
            <div data-fu-picker class="hidden" style="margin-top:12px"></div>
          </div>`}
          <div class="form-actions">
            <a class="btn" href="#/schedule">Cancel</a>
            <button class="btn primary" type="submit">${icon('check')} ${existing ? 'Save changes' : 'Save & generate prescription'}</button>
          </div>
        </div>
      </form>
    </div>`;

  consultationTimeline($('[data-prev]', root), previous, { empty: 'First visit — no previous consultations' });

  const form = $('[data-form]', root);
  const items = $('[data-items]', form);
  $('[data-add-item]', form).addEventListener('click', () => {
    items.insertAdjacentHTML('beforeend', itemRow());
    items.lastElementChild.querySelector('input').focus();
  });
  items.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    if (items.children.length > 1) btn.closest('tr').remove();
    else btn.closest('tr').querySelectorAll('input').forEach(i => { i.value = ''; });
  });

  let followUp = null;
  const fuBox = $('[data-fu]', form);
  if (fuBox) {
    let picker = null;
    fuBox.addEventListener('change', () => {
      const pane = $('[data-fu-picker]', form);
      pane.classList.toggle('hidden', !fuBox.checked);
      if (fuBox.checked && !picker) {
        const d = new Date(); d.setDate(d.getDate() + 14);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        picker = slotPicker(pane, { doctorId: appt.doctor_id, patientId: appt.patient_id, day: isoDay(d), onChange: s => { followUp = s; } });
      }
      if (!fuBox.checked) followUp = null;
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (fuBox?.checked && !followUp) { toast('Pick a follow-up slot or untick follow-up', 'error'); return; }
    const data = formData(form);
    const rows = [...items.children].map(tr => Object.fromEntries([...tr.querySelectorAll('input')].map(i => [i.name, i.value.trim() || null])));
    const body = {
      appointment_id: appt.id,
      symptoms: data.symptoms, diagnosis: data.diagnosis, notes: data.notes,
      lab_results: data.lab_results, prescription: data.prescription,
      items: rows.filter(r => r.medication),
      follow_up: followUp,
    };
    await busy($('[type=submit]', form), async () => {
      try {
        const saved = existing
          ? await api(`/consultations/${existing.id}`, { method: 'PUT', body })
          : await api('/consultations', { method: 'POST', body });
        toast(existing ? 'Consultation updated' : `Consultation saved${saved.follow_up_id ? ' · follow-up booked' : ''}`);
        location.hash = `#/prescription/${saved.id}`;
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}
