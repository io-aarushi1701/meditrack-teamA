// App shell, hash router and notification bell.
import { api, session } from './api.js';
import { $, $$, esc, fmtRelative, icon, initials, LOGO, toast } from './ui.js';
import { renderAuth } from './views/auth.js';
import { auditView, dashboardView, doctorsView } from './views/admin.js';
import { appointmentsView } from './views/appointments.js';
import { consultView, scheduleView } from './views/doctor.js';
import { bookView, historyView, homeView, myAppointmentsView, profileView } from './views/patient.js';
import { patientDetailView, patientsView } from './views/patients.js';
import { prescriptionView } from './views/prescription.js';

const NAV = {
  ADMIN: [
    ['#/dashboard', 'Dashboard', 'dashboard'],
    ['#/patients', 'Patients', 'users'],
    ['#/appointments', 'Appointments', 'calendar'],
    ['#/doctors', 'Doctors', 'stethoscope'],
    ['#/audit', 'Audit log', 'shield'],
  ],
  DOCTOR: [
    ['#/schedule', 'My schedule', 'calendar'],
    ['#/appointments', 'Appointments', 'clipboard'],
    ['#/patients', 'Patients', 'users'],
  ],
  PATIENT: [
    ['#/home', 'Home', 'home'],
    ['#/book', 'Book appointment', 'plus'],
    ['#/my-appointments', 'My appointments', 'calendar'],
    ['#/history', 'Health history', 'pill'],
    ['#/profile', 'My profile', 'user'],
  ],
};

// [pattern, view, roles allowed, page title]
const ROUTES = [
  [/^\/dashboard$/, dashboardView, ['ADMIN'], 'Dashboard'],
  [/^\/patients$/, patientsView, ['ADMIN', 'DOCTOR'], 'Patients'],
  [/^\/patients\/(?<id>\d+)$/, patientDetailView, ['ADMIN', 'DOCTOR'], 'Patient record'],
  [/^\/appointments$/, appointmentsView, ['ADMIN', 'DOCTOR'], 'Appointments'],
  [/^\/doctors$/, doctorsView, ['ADMIN'], 'Doctors'],
  [/^\/audit$/, auditView, ['ADMIN'], 'Audit log'],
  [/^\/schedule$/, scheduleView, ['DOCTOR'], 'My schedule'],
  [/^\/consult\/(?<id>\d+)$/, consultView, ['DOCTOR'], 'Consultation'],
  [/^\/home$/, homeView, ['PATIENT'], 'Home'],
  [/^\/book$/, bookView, ['PATIENT'], 'Book appointment'],
  [/^\/my-appointments$/, myAppointmentsView, ['PATIENT'], 'My appointments'],
  [/^\/history$/, historyView, ['PATIENT'], 'Health history'],
  [/^\/profile$/, profileView, ['PATIENT'], 'My profile'],
  [/^\/prescription\/(?<id>\d+)$/, prescriptionView, ['ADMIN', 'DOCTOR', 'PATIENT'], 'Prescription'],
];

const app = document.getElementById('app');
let shellRendered = false;
let pollTimer = null;

function homeFor(role) { return NAV[role][0][0]; }

function renderShell() {
  const u = session.user;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">${LOGO}</span>
          <div><div class="brand-name">MediTrack</div><div class="brand-sub">Health records & scheduling</div></div></div>
        <nav class="nav">${NAV[u.role].map(([href, label, ic]) => `<a href="${href}">${icon(ic)}<span>${label}</span></a>`).join('')}</nav>
        <div class="sidebar-foot">Signed in as <span class="tag role">${u.role.toLowerCase()}</span></div>
      </aside>
      <div class="main">
        <header class="topbar">
          <span class="muted small" data-crumb></span>
          <div class="spacer"></div>
          <div style="position:relative">
            <button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="badge-count hidden" data-badge></span></button>
            <div class="notif-panel hidden" data-panel></div>
          </div>
          <div class="user-chip">
            <span class="avatar" data-avatar></span>
            <div class="who"><b data-name></b><span data-email></span></div>
          </div>
          <button class="icon-btn" data-logout aria-label="Sign out" title="Sign out">${icon('logout')}</button>
        </header>
        <main class="page" data-page></main>
      </div>
    </div>`;
  updateUserChip();
  $('[data-logout]').addEventListener('click', logout);
  setupNotifications();
  shellRendered = true;
}

function updateUserChip() {
  const u = session.user;
  $('[data-avatar]').textContent = initials(u.name) || 'A';
  $('[data-name]').textContent = u.name;
  $('[data-email]').textContent = u.email;
}

// ------------------------------------------------------------------ notifications
const KIND_ICON = { REMINDER: 'clock', MISSED: 'alert', CANCELLED: 'x', PRESCRIPTION: 'pill', FOLLOW_UP: 'calendar', RESCHEDULED: 'calendar', BOOKED: 'check' };

function setupNotifications() {
  const bell = $('[data-bell]'), panel = $('[data-panel]');
  bell.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) loadNotifications(true);
  });
  document.addEventListener('click', e => { if (!panel.contains(e.target)) panel.classList.add('hidden'); });
  loadNotifications(false);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadNotifications(!panel.classList.contains('hidden')), 60000);
}

async function loadNotifications(renderList) {
  if (!session.token) return;
  let data;
  try { data = await api('/notifications'); } catch { return; }
  const badge = $('[data-badge]');
  if (!badge) return;
  badge.textContent = data.unread > 9 ? '9+' : data.unread;
  badge.classList.toggle('hidden', !data.unread);
  if (!renderList) return;
  const panel = $('[data-panel]');
  panel.innerHTML = `
    <header><h3>Notifications</h3>${data.unread ? '<button class="btn sm ghost" data-readall>Mark all read</button>' : ''}</header>
    <div class="notif-list">${data.items.length ? data.items.map(n => `
      <div class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
        <span class="dot"></span>
        <div style="flex:1"><p>${esc(n.message)}</p><time>${esc(fmtRelative(n.created_at))}</time></div>
        <span class="muted" style="width:16px">${icon(KIND_ICON[n.kind] || 'bell', 'width="16" height="16"')}</span>
      </div>`).join('') : '<div class="empty">You\'re all caught up</div>'}</div>`;
  $('[data-readall]', panel)?.addEventListener('click', async e => {
    e.stopPropagation();
    await api('/notifications/read-all', { method: 'POST' });
    loadNotifications(true);
  });
  $$('.notif.unread', panel).forEach(el => el.addEventListener('click', async e => {
    e.stopPropagation();
    await api(`/notifications/${el.dataset.id}/read`, { method: 'POST' });
    loadNotifications(true);
  }));
}

// ------------------------------------------------------------------ routing
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(qs || '');

  if (!session.token || !session.user) {
    shellRendered = false;
    clearInterval(pollTimer);
    if (path !== '/login' && path !== '/register') { location.replace('#/login'); return; }
    document.title = 'Sign in · MediTrack';
    renderAuth(app, { mode: path === '/register' ? 'register' : 'login', onAuthed: () => {
      location.hash = homeFor(session.user.role);
      route();
    } });
    return;
  }

  const role = session.user.role;
  const match = ROUTES.map(([re, view, roles, title]) => ({ m: path.match(re), view, roles, title })).find(r => r.m);
  if (!match || !match.roles.includes(role)) { location.replace(homeFor(role)); return; }

  if (!shellRendered) renderShell();
  $$('.nav a').forEach(a => a.classList.toggle('active', path.startsWith(a.getAttribute('href').slice(1))));
  $('[data-crumb]').textContent = match.title;
  document.title = `${match.title} · MediTrack`;

  const page = $('[data-page]');
  page.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);
  try {
    await match.view(page, { ...(match.m.groups || {}), query });
  } catch (err) {
    page.innerHTML = `<div class="callout danger">${icon('alert')}<div><b>Couldn't load this page.</b> ${esc(err.message)}</div></div>`;
  }
  loadNotifications(false);
}

function logout() {
  session.clear();
  shellRendered = false;
  clearInterval(pollTimer);
  toast('Signed out');
  location.hash = '#/login';
}

window.addEventListener('hashchange', route);
window.addEventListener('meditrack:logout', () => {
  shellRendered = false;
  toast('Your session has ended — please sign in again', 'error');
  location.hash = '#/login';
  route();
});
window.addEventListener('meditrack:user', () => { if (shellRendered) updateUserChip(); });
route();
