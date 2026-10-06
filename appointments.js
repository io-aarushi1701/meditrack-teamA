import { api, session } from '../api.js';
import { appointmentTable, openBookingModal } from '../components.js';
import { $, esc, icon, isoDay, loading } from '../ui.js';

const RANGES = {
  upcoming: () => ({ date_from: isoDay(new Date()) }),
  today: () => ({ date_from: isoDay(new Date()), date_to: isoDay(new Date()) }),
  week: () => {
    const d = new Date(), end = new Date();
    end.setDate(d.getDate() + 7);
    return { date_from: isoDay(d), date_to: isoDay(end) };
  },
  past: () => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return { date_to: isoDay(y) };
  },
  all: () => ({}),
};

/** Staff view of all appointments (doctors see only their own — enforced by the API). */
export async function appointmentsView(root, { query }) {
  const isAdmin = session.user.role === 'ADMIN';
  const doctors = isAdmin ? await api('/doctors') : [];
  const state = { range: 'upcoming', status: '', doctor: query.get('doctor') || '' };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Appointments</h1><p class="muted" data-count></p></div>
      <button class="btn primary" data-book>${icon('plus')} New appointment</button>
    </div>
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap">
        <div class="seg" data-range>${Object.keys(RANGES).map(r => `<button data-r="${r}" class="${r === state.range ? 'active' : ''}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div>
        <div class="row">
          ${isAdmin ? `<select data-doctor style="width:auto"><option value="">All doctors</option>${doctors.map(d => `<option value="${d.id}" ${String(d.id) === state.doctor ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
          <select data-status style="width:auto">
            <option value="">Any status</option><option value="BOOKED">Booked</option><option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option><option value="NO_SHOW">No-show</option>
          </select>
        </div>
      </div>
      <div class="card-body flush" data-list>${loading()}</div>
    </div>`;

  async function load() {
    const appts = await api('/appointments', { query: { ...RANGES[state.range](), status: state.status, doctor_id: state.doctor } });
    if (state.range === 'past' || state.range === 'all') appts.reverse();
    $('[data-count]', root).textContent = `${appts.length} appointment${appts.length === 1 ? '' : 's'}`;
    appointmentTable($('[data-list]', root), appts, {
      columns: isAdmin ? ['patient', 'doctor'] : ['patient'], onChange: load, empty: 'No appointments match these filters',
    });
  }

  $('[data-range]', root).addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    state.range = b.dataset.r;
    root.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('active', x === b));
    load();
  });
  $('[data-status]', root).addEventListener('change', e => { state.status = e.target.value; load(); });
  if (isAdmin) $('[data-doctor]', root).addEventListener('change', e => { state.doctor = e.target.value; load(); });
  $('[data-book]', root).addEventListener('click', async () => { if (await openBookingModal()) load(); });
  await load();
}
