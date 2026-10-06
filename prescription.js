import { api, session } from '../api.js';
import { $, esc, fmtDate, fmtDateTime, icon, pid } from '../ui.js';

/** Printable digital prescription for one consultation. */
export async function prescriptionView(root, { id }) {
  const c = await api(`/consultations/${id}`);
  const [patient, followUps] = await Promise.all([
    api(`/patients/${c.patient_id}`),
    api('/appointments', { query: { patient_id: c.patient_id, status: 'BOOKED' } }),
  ]);
  const followUp = followUps.find(a => (a.reason || '').startsWith('Follow-up') && new Date(a.slot) > new Date(c.slot));
  const canEdit = session.user.role === 'DOCTOR' && session.user.doctor_id === c.doctor_id;
  const back = session.user.role === 'PATIENT' ? '#/history' : session.user.role === 'DOCTOR' ? '#/schedule' : `#/patients/${c.patient_id}`;

  root.innerHTML = `
    <div class="row between no-print" style="margin-bottom:14px">
      <a href="${back}" class="btn ghost sm">${icon('chevronLeft')} Back</a>
      <div class="row">
        ${canEdit ? `<a class="btn" href="#/consult/${c.appointment_id}">${icon('edit')} Edit</a>` : ''}
        <button class="btn primary" data-print>${icon('printer')} Print / save PDF</button>
      </div>
    </div>
    <article class="card rx-doc">
      <header class="rx-head">
        <div><h2>MediTrack Clinic</h2><p class="muted small">Digital prescription · Ref RX-${String(c.id).padStart(5, '0')}</p></div>
        <div style="text-align:right"><b>${esc(c.doctor_name)}</b><p class="muted small">${esc(c.specialty || '')}</p>
          <p class="muted small">${esc(fmtDateTime(c.slot))}</p></div>
      </header>
      <dl class="kv" style="margin-top:18px;grid-template-columns:repeat(4,minmax(0,1fr))">
        <div><dt>Patient</dt><dd><b>${esc(patient.name)}</b></dd></div>
        <div><dt>Patient ID</dt><dd>${pid(patient.id)}</dd></div>
        <div><dt>Date of birth</dt><dd>${patient.date_of_birth ? esc(fmtDate(patient.date_of_birth + 'T00:00:00')) : '—'}</dd></div>
        <div><dt>Allergies</dt><dd>${esc(patient.allergies || 'Not recorded')}</dd></div>
      </dl>
      <div style="margin-top:20px" class="stack">
        ${c.symptoms ? `<div><h3>Symptoms</h3><p>${esc(c.symptoms)}</p></div>` : ''}
        <div><h3>Diagnosis</h3><p>${esc(c.diagnosis || '—')}</p></div>
        ${c.notes ? `<div><h3>Observations</h3><p>${esc(c.notes)}</p></div>` : ''}
        ${c.lab_results ? `<div><h3>Lab results</h3><p>${esc(c.lab_results)}</p></div>` : ''}
      </div>
      <div class="rx-symbol">℞</div>
      ${c.items.length ? `<div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
        <tbody>${c.items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.medication)}</b></td><td>${esc(i.dosage || '—')}</td>
          <td>${esc(i.frequency || '—')}</td><td>${esc(i.duration || '—')}</td><td>${esc(i.instructions || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No medication prescribed.</p>'}
      ${c.prescription ? `<div style="margin-top:18px"><h3>Advice</h3><p>${esc(c.prescription)}</p></div>` : ''}
      ${followUp ? `<div class="callout info" style="margin-top:18px">${icon('calendar')}<div>Follow-up booked for <b>${esc(fmtDateTime(followUp.slot))}</b></div></div>` : ''}
      <div class="rx-sign"><div><b>${esc(c.doctor_name)}</b><p class="muted small">Electronically signed · ${esc(fmtDate(c.created_at))}</p></div></div>
    </article>`;
  $('[data-print]', root).addEventListener('click', () => window.print());
}
