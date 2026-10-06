// Reusable pieces: patient form, slot picker, booking flow, appointment table, consultation timeline.
import { api, session } from './api.js';
import {
  $, $$, age, busy, confirmDialog, emptyState, esc, fmtDate, fmtDateTime, fmtTime, formData, icon, initials,
  isoDay, loading, modal, nextWorkday, pid, statusPill, toast,
} from './ui.js';

// ------------------------------------------------------------------ patient form
const GENDERS = ['Female', 'Male', 'Other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function opt(list, value) {
  return '<option value="">—</option>' + list.map(v => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('');
}
function input(name, label, p, { type = 'text', req = false, full = false, attrs = '' } = {}) {
  return `<label class="field ${full ? 'full' : ''}">${esc(label)}${req ? ' <span class="req">*</span>' : ''}
    <input name="${name}" type="${type}" value="${esc(p[name] ?? '')}" ${req ? 'required' : ''} ${attrs}></label>`;
}
function area(name, label, p, placeholder = '') {
  return `<label class="field full">${esc(label)}<textarea name="${name}" rows="2" placeholder="${esc(placeholder)}">${esc(p[name] ?? '')}</textarea></label>`;
}

/** Full patient profile form. password: 'none' | 'optional' | 'required' */
export function patientFormHtml(p = {}, { password = 'none' } = {}) {
  const today = isoDay(new Date());
  return `
    <div class="form-section">
      <h3>Personal details</h3>
      <div class="form-grid">
        ${input('name', 'Full name', p, { req: true, attrs: 'minlength="2" autocomplete="name"' })}
        ${input('email', 'Email', p, { type: 'email', req: true, attrs: 'autocomplete="email"' })}
        ${password !== 'none' ? `<label class="field full">Password${password === 'required' ? ' <span class="req">*</span>' : ' <span class="muted">(optional — creates a patient login)</span>'}
          <input name="password" type="password" minlength="6" ${password === 'required' ? 'required' : ''} autocomplete="new-password"></label>` : ''}
        ${input('phone', 'Phone', p, { type: 'tel', attrs: 'autocomplete="tel"' })}
        ${input('date_of_birth', 'Date of birth', p, { type: 'date', attrs: `max="${today}"` })}
        <label class="field">Gender<select name="gender">${opt(GENDERS, p.gender)}</select></label>
        <label class="field">Blood type<select name="blood_type">${opt(BLOOD, p.blood_type)}</select></label>
        ${input('address', 'Address', p, { full: true })}
      </div>
    </div>
    <div class="form-section">
      <h3>Medical information</h3>
      <div class="form-grid">
        ${area('allergies', 'Allergies', p, 'e.g. Penicillin, peanuts — or "None"')}
        ${area('chronic_conditions', 'Chronic conditions', p, 'e.g. Asthma, Type 2 diabetes')}
        ${area('current_medications', 'Current medications', p, 'e.g. Metformin 500mg twice daily')}
        ${area('medical_history', 'Medical history', p, 'Past surgeries, hospitalisations, family history…')}
      </div>
    </div>
    <div class="form-section">
      <h3>Emergency contact & insurance</h3>
      <div class="form-grid">
        ${input('emergency_contact_name', 'Emergency contact name', p)}
        ${input('emergency_contact_phone', 'Emergency contact phone', p, { type: 'tel' })}
        ${input('insurance_provider', 'Insurance provider', p)}
        ${input('insurance_number', 'Policy number', p)}
      </div>
    </div>`;
}

export function readPatientForm(form) {
  const data = formData(form);
  if (!data.password) delete data.password;
  return data;
}

/** Opens the patient form in a modal; resolves with the saved patient. */
export function openPatientForm(existing = null) {
  const isEdit = !!existing;
  const canCreateLogin = !isEdit && session.user.role !== 'PATIENT';
  return new Promise(resolve => {
    const form = document.createElement('form');
    form.innerHTML = patientFormHtml(existing || {}, { password: canCreateLogin ? 'optional' : 'none' }) +
      `<div class="form-actions"><button type="button" class="btn" data-close>Cancel</button>
       <button class="btn primary" type="submit">${isEdit ? 'Save changes' : 'Register patient'}</button></div>`;
    const m = modal({ title: isEdit ? 'Edit patient record' : 'Register new patient', body: form, wide: true });
    form.querySelector('[data-close]').addEventListener('click', m.close);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = readPatientForm(form);
      const btn = form.querySelector('[type=submit]');
      await busy(btn, async () => {
        try {
          let saved;
          if (isEdit) {
            saved = await api(`/patients/${existing.id}`, { method: 'PUT', body: data });
          } else {
            try {
              saved = await api('/patients', { method: 'POST', body: data });
            } catch (err) {
              if (err.status !== 409) throw err;
              const ok = await confirmDialog(err.message, { title: 'Possible duplicate', confirmText: 'Register anyway' });
              if (!ok) return;
              saved = await api('/patients', { method: 'POST', body: data, query: { allow_duplicate: true } });
            }
          }
          toast(isEdit ? 'Patient record updated' : `Registered ${saved.name} (${pid(saved.id)})`);
          m.close();
          resolve(saved);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
}

// ------------------------------------------------------------------ patient summary
export function patientBanner(p) {
  const a = age(p.date_of_birth);
  const allergies = p.allergies && !/^none$/i.test(p.allergies.trim());
  return `
    <div class="row" style="gap:16px;align-items:center">
      <div class="avatar lg">${esc(initials(p.name))}</div>
      <div style="flex:1;min-width:0">
        <div class="row"><h1>${esc(p.name)}</h1><span class="tag">${pid(p.id)}</span></div>
        <p class="muted" style="margin-top:2px">${[a != null ? `${a} yrs` : null, p.gender, p.blood_type ? `Blood ${p.blood_type}` : null, p.phone, p.email].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="row" style="margin-top:8px">
          ${allergies ? `<span class="tag alert">Allergies: ${esc(p.allergies)}</span>` : '<span class="tag">No known allergies</span>'}
          ${p.chronic_conditions ? `<span class="tag">${esc(p.chronic_conditions)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

export function patientDetailsHtml(p) {
  const v = x => x ? esc(x) : '<span class="muted">—</span>';
  return `
    <dl class="kv">
      <div><dt>Date of birth</dt><dd>${p.date_of_birth ? fmtDate(p.date_of_birth + 'T00:00:00') : v()}</dd></div>
      <div><dt>Phone</dt><dd>${v(p.phone)}</dd></div>
      <div><dt>Address</dt><dd>${v(p.address)}</dd></div>
      <div><dt>Registered</dt><dd>${fmtDate(p.created_at)}</dd></div>
      <div><dt>Allergies</dt><dd>${v(p.allergies)}</dd></div>
      <div><dt>Chronic conditions</dt><dd>${v(p.chronic_conditions)}</dd></div>
      <div><dt>Current medications</dt><dd>${v(p.current_medications)}</dd></div>
      <div><dt>Medical history</dt><dd>${v(p.medical_history)}</dd></div>
      <div><dt>Emergency contact</dt><dd>${v([p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(' · '))}</dd></div>
      <div><dt>Insurance</dt><dd>${v([p.insurance_provider, p.insurance_number].filter(Boolean).join(' · '))}</dd></div>
    </dl>`;
}

export function missingFieldsCallout(p, { self = false, link = '' } = {}) {
  if (!p.missing_fields || !p.missing_fields.length) return '';
  return `<div class="callout warn">${icon('alert')}<div><b>${self ? 'Your profile is incomplete.' : 'Incomplete record.'}</b>
    Missing: ${p.missing_fields.map(esc).join(', ')}.${link ? ` <a href="${link}">Complete profile →</a>` : ''}</div></div>`;
}

// ------------------------------------------------------------------ slot picker
/**
 * Day picker + hourly slot grid for one doctor.
 * Returns { get value(), setDoctor(id), setDay(iso) }.
 */
export function slotPicker(container, { doctorId, day, onChange, patientId = null } = {}) {
  let selected = null;
  let currentDoctor = doctorId;
  let currentPatient = patientId;
  const startDay = day || isoDay(nextWorkday());
  container.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <button type="button" class="icon-btn" data-prev aria-label="Previous day">${icon('chevronLeft')}</button>
      <input type="date" data-day value="${startDay}" min="${isoDay(new Date())}" style="width:auto">
      <button type="button" class="icon-btn" data-next aria-label="Next day">${icon('chevronRight')}</button>
      <span class="muted small" data-dayname></span>
    </div>
    <div data-slots></div>`;
  const dayInput = $('[data-day]', container);
  const slotsEl = $('[data-slots]', container);

  function shift(delta) {
    const d = new Date(dayInput.value + 'T00:00:00');
    do { d.setDate(d.getDate() + delta); } while (d.getDay() === 0 || d.getDay() === 6);
    if (isoDay(d) < dayInput.min) return;
    dayInput.value = isoDay(d);
    load();
  }

  async function load() {
    selected = null;
    onChange && onChange(null);
    const d = new Date(dayInput.value + 'T00:00:00');
    $('[data-dayname]', container).textContent = isNaN(d) ? '' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    if (!currentDoctor) { slotsEl.innerHTML = '<p class="muted small">Choose a doctor first.</p>'; return; }
    if (!dayInput.value) return;
    slotsEl.innerHTML = '<p class="muted small">Loading slots…</p>';
    try {
      const slots = await api(`/doctors/${currentDoctor}/slots`, { query: { day: dayInput.value, patient_id: currentPatient } });
      if (slots.every(s => s.state === 'closed')) {
        slotsEl.innerHTML = '<div class="callout info">' + icon('info') + 'The clinic is closed on weekends. Pick a weekday.</div>';
        return;
      }
      const free = slots.filter(s => s.available).length;
      slotsEl.innerHTML = `<div class="slots">${slots.map(s => `
        <button type="button" class="slot" data-slot="${s.slot}" ${s.available ? '' : 'disabled'}
          title="${{ booked: 'Doctor already booked', past: 'In the past', busy: 'Patient has another appointment' }[s.state] || 'Available'}">${fmtTime(s.slot)}</button>`).join('')}</div>
        <p class="muted small" style="margin-top:8px">${free ? `${free} of ${slots.length} slots free` : 'No free slots this day — try another day.'}</p>`;
      $$('[data-slot]', slotsEl).forEach(btn => btn.addEventListener('click', () => {
        $$('.slot', slotsEl).forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selected = btn.dataset.slot;
        onChange && onChange(selected);
      }));
    } catch (err) { slotsEl.innerHTML = `<div class="callout danger">${esc(err.message)}</div>`; }
  }

  $('[data-prev]', container).addEventListener('click', () => shift(-1));
  $('[data-next]', container).addEventListener('click', () => shift(1));
  dayInput.addEventListener('change', load);
  load();

  return {
    get value() { return selected; },
    setDoctor(id) { currentDoctor = id; load(); },
    setPatient(id) { currentPatient = id; load(); },
    async select(slotIso) {
      dayInput.value = slotIso.slice(0, 10);
      await load();
      const btn = slotsEl.querySelector(`[data-slot="${slotIso}"]`);
      if (btn && !btn.disabled) btn.click();
    },
  };
}

// ------------------------------------------------------------------ booking flow
/**
 * Specialty → doctor → day/slot → reason. Staff also pick the patient.
 * onBooked(appointment) is called after a successful booking.
 */
export async function bookingFlow(container, { patientId = null, onBooked } = {}) {
  const isStaff = session.user.role !== 'PATIENT';
  container.innerHTML = loading();
  const [doctors, specialties, patients] = await Promise.all([
    api('/doctors'), api('/specialties'), isStaff && !patientId ? api('/patients') : Promise.resolve(null),
  ]);
  let doctorId = null, n = 1;

  container.innerHTML = `
    <form class="steps">
      ${patients ? `<section>
        <div class="step-title"><span class="step-num">${n++}</span><h3>Patient</h3></div>
        <select name="patient_id" required><option value="">Select a patient…</option>
          ${patients.map(p => `<option value="${p.id}">${esc(p.name)} — ${pid(p.id)} · ${esc(p.email)}</option>`).join('')}</select>
      </section>` : ''}
      <section>
        <div class="step-title"><span class="step-num">${n++}</span><h3>Choose a doctor</h3></div>
        <div class="row" style="margin-bottom:12px">
          <div class="search" style="flex:1;min-width:180px">${icon('search')}<input data-q placeholder="Search doctor or specialty"></div>
          <select data-spec style="width:auto"><option value="">All specialties</option>${specialties.map(s => `<option>${esc(s)}</option>`).join('')}</select>
        </div>
        <div class="doctor-list" data-doctors></div>
      </section>
      <section>
        <div class="step-title"><span class="step-num">${n++}</span><h3>Pick a time</h3>
          <button type="button" class="btn sm" data-earliest style="margin-left:auto" disabled>${icon('zap')} Earliest available</button></div>
        <div data-picker></div>
      </section>
      <section>
        <div class="step-title"><span class="step-num">${n++}</span><h3>Reason for visit</h3></div>
        <input name="reason" maxlength="255" placeholder="e.g. Follow-up for blood pressure, skin rash…">
      </section>
      <div class="row between">
        <p class="muted small" data-summary>Select a doctor and a slot to continue.</p>
        <button class="btn primary" type="submit" disabled>${icon('check')} Confirm booking</button>
      </div>
    </form>`;

  const form = $('form', container);
  const submit = $('[type=submit]', form);
  const doctorsEl = $('[data-doctors]', form);
  const earliest = $('[data-earliest]', form);

  function updateSummary(slot) {
    const doc = doctors.find(d => d.id === doctorId);
    submit.disabled = !(doc && slot);
    $('[data-summary]', form).textContent = doc && slot ? `${doc.name} · ${fmtDateTime(slot)}` : 'Select a doctor and a slot to continue.';
  }
  const currentPatient = () => patientId || +($('[name=patient_id]', form)?.value || 0) || session.user.patient_id;
  const picker = slotPicker($('[data-picker]', form), { onChange: updateSummary, patientId: currentPatient() });
  $('[name=patient_id]', form)?.addEventListener('change', () => picker.setPatient(currentPatient()));

  function renderDoctors() {
    const q = $('[data-q]', form).value.trim().toLowerCase();
    const spec = $('[data-spec]', form).value;
    const list = doctors.filter(d => (!spec || d.specialty === spec) &&
      (!q || d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q)));
    doctorsEl.innerHTML = list.length ? list.map(d => `
      <button type="button" class="doctor-card ${d.id === doctorId ? 'selected' : ''}" data-id="${d.id}">
        <span class="avatar">${esc(initials(d.name))}</span>
        <span class="meta"><b>${esc(d.name)}</b><span>${esc(d.specialty)}</span></span>
      </button>`).join('') : '<p class="muted small">No doctors match.</p>';
    $$('[data-id]', doctorsEl).forEach(b => b.addEventListener('click', () => {
      doctorId = +b.dataset.id;
      earliest.disabled = false;
      renderDoctors();
      picker.setDoctor(doctorId);
    }));
  }
  $('[data-q]', form).addEventListener('input', renderDoctors);
  $('[data-spec]', form).addEventListener('change', renderDoctors);
  renderDoctors();

  earliest.addEventListener('click', async () => {
    try {
      const { slot } = await api(`/doctors/${doctorId}/next-available`, { query: { patient_id: currentPatient() } });
      await picker.select(slot);
      toast(`Earliest slot: ${fmtDateTime(slot)}`);
    } catch (err) { toast(err.message, 'error'); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = formData(form);
    const body = {
      patient_id: currentPatient(),
      doctor_id: doctorId,
      slot: picker.value,
      reason: data.reason,
    };
    await busy(submit, async () => {
      try {
        const appt = await api('/appointments', { method: 'POST', body });
        toast(`Booked with ${appt.doctor_name} on ${fmtDateTime(appt.slot)}`);
        onBooked && onBooked(appt);
      } catch (err) {
        toast(err.message, 'error');
        if (err.status === 409) picker.setDoctor(doctorId);
      }
    });
  });
}

export function openBookingModal({ patientId = null } = {}) {
  return new Promise(resolve => {
    const body = document.createElement('div');
    const m = modal({ title: 'Book appointment', body, wide: true });
    bookingFlow(body, { patientId, onBooked: appt => { m.close(); resolve(appt); } })
      .catch(err => { body.innerHTML = `<div class="callout danger">${esc(err.message)}</div>`; });
  });
}

// ------------------------------------------------------------------ reschedule / cancel
export function openReschedule(appt) {
  return new Promise(resolve => {
    const body = document.createElement('div');
    body.innerHTML = `<p class="muted" style="margin-bottom:14px">Currently <b>${esc(fmtDateTime(appt.slot))}</b> with ${esc(appt.doctor_name)}.</p><div data-picker></div>`;
    const m = modal({
      title: 'Reschedule appointment', body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save disabled>Move appointment</button>',
    });
    const save = $('[data-save]', m.el);
    const picker = slotPicker($('[data-picker]', body), {
      doctorId: appt.doctor_id, patientId: appt.patient_id, onChange: s => { save.disabled = !s; },
    });
    save.addEventListener('click', () => busy(save, async () => {
      try {
        const updated = await api(`/appointments/${appt.id}`, { method: 'PATCH', query: { slot: picker.value } });
        toast(`Moved to ${fmtDateTime(updated.slot)}`);
        m.close();
        resolve(updated);
      } catch (err) { toast(err.message, 'error'); }
    }));
  });
}

export async function cancelAppointment(appt) {
  const ok = await confirmDialog(`Cancel the appointment with ${appt.doctor_name} on ${fmtDateTime(appt.slot)}?`,
    { title: 'Cancel appointment', confirmText: 'Cancel appointment', danger: true });
  if (!ok) return null;
  try {
    const updated = await api(`/appointments/${appt.id}`, { method: 'PATCH', query: { status: 'CANCELLED' } });
    toast('Appointment cancelled');
    return updated;
  } catch (err) { toast(err.message, 'error'); return null; }
}

// ------------------------------------------------------------------ appointment table
/**
 * Renders a table of appointments with role-appropriate actions.
 * columns: which of 'patient' | 'doctor' to show. onChange() reloads the caller.
 */
export function appointmentTable(container, appts, { columns = ['patient', 'doctor'], onChange, empty = 'No appointments' } = {}) {
  if (!appts.length) { container.innerHTML = emptyState(empty, 'calendar'); return; }
  const role = session.user.role;
  const now = new Date();
  container.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Date & time</th>${columns.includes('patient') ? '<th>Patient</th>' : ''}${columns.includes('doctor') ? '<th>Doctor</th>' : ''}<th>Reason</th><th>Status</th><th></th></tr></thead>
    <tbody>${appts.map(a => {
      const upcoming = a.status === 'BOOKED' && new Date(a.slot) > now;
      const actions = [];
      if (role === 'DOCTOR' && ['BOOKED', 'NO_SHOW'].includes(a.status) && !a.has_consultation) {
        actions.push(`<a class="btn sm primary" href="#/consult/${a.id}">Consult</a>`);
      }
      if (a.has_consultation) actions.push(`<button class="btn sm" data-act="rx" data-id="${a.id}">${icon('file')} Record</button>`);
      if (upcoming) {
        actions.push(`<button class="btn sm" data-act="move" data-id="${a.id}">Reschedule</button>`);
        actions.push(`<button class="btn sm danger" data-act="cancel" data-id="${a.id}">Cancel</button>`);
      }
      return `<tr>
        <td class="mono"><b>${esc(fmtDate(a.slot, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span class="sub">${esc(fmtTime(a.slot))} · ${new Date(a.slot).getFullYear()}</span></td>
        ${columns.includes('patient') ? `<td>${role === 'PATIENT' ? esc(a.patient_name) : `<a href="#/patients/${a.patient_id}">${esc(a.patient_name)}</a>`}<span class="sub">${pid(a.patient_id)}</span></td>` : ''}
        ${columns.includes('doctor') ? `<td>${esc(a.doctor_name)}<span class="sub">${esc(a.specialty || '')}</span></td>` : ''}
        <td style="max-width:260px">${esc(a.reason || '—')}</td>
        <td>${statusPill(a.status)}</td>
        <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">${actions.join('')}</div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;

  const byId = id => appts.find(a => a.id === +id);
  $$('[data-act]', container).forEach(btn => btn.addEventListener('click', async () => {
    const a = byId(btn.dataset.id);
    if (btn.dataset.act === 'move') { if (await openReschedule(a)) onChange && onChange(); }
    if (btn.dataset.act === 'cancel') { if (await cancelAppointment(a)) onChange && onChange(); }
    if (btn.dataset.act === 'rx') {
      try {
        const [c] = await api('/consultations', { query: { appointment_id: a.id } });
        if (c) location.hash = `#/prescription/${c.id}`;
      } catch (err) { toast(err.message, 'error'); }
    }
  }));
}

// ------------------------------------------------------------------ consultation timeline
export function rxLine(i) {
  return [i.medication, i.dosage, i.frequency, i.duration && `for ${i.duration}`].filter(Boolean).map(esc).join(' · ') +
    (i.instructions ? ` <span class="muted">— ${esc(i.instructions)}</span>` : '');
}

export function consultationTimeline(container, consults, { showPatient = false, empty = 'No consultations recorded yet' } = {}) {
  if (!consults.length) { container.innerHTML = emptyState(empty, 'stethoscope'); return; }
  container.innerHTML = `<div class="timeline">${consults.map(c => `
    <div class="tl-item">
      <div class="tl-date"><b>${esc(fmtDate(c.slot || c.created_at, { day: 'numeric', month: 'short' }))}</b>${new Date(c.slot || c.created_at).getFullYear()}</div>
      <div>
        <div class="row between">
          <div><h3>${esc(c.diagnosis || 'Consultation')}</h3>
            <p class="muted small">${showPatient ? `${esc(c.patient_name)} · ` : ''}${esc(c.doctor_name)} · ${esc(c.specialty || '')}</p></div>
          <a class="btn sm" href="#/prescription/${c.id}">${icon('file')} View</a>
        </div>
        ${c.symptoms ? `<p class="small" style="margin-top:8px"><span class="muted">Symptoms:</span> ${esc(c.symptoms)}</p>` : ''}
        ${c.notes ? `<p class="small"><span class="muted">Notes:</span> ${esc(c.notes)}</p>` : ''}
        ${c.lab_results ? `<p class="small"><span class="muted">Lab results:</span> ${esc(c.lab_results)}</p>` : ''}
        ${c.items.length ? `<ul class="rx-list">${c.items.map(i => `<li>${rxLine(i)}</li>`).join('')}</ul>` : ''}
        ${c.prescription ? `<p class="small" style="margin-top:6px"><span class="muted">Advice:</span> ${esc(c.prescription)}</p>` : ''}
      </div>
    </div>`).join('')}</div>`;
}
