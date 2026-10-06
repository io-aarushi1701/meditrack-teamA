import { api, session } from '../api.js';
import { patientFormHtml, readPatientForm } from '../components.js';
import { $, $$, busy, esc, formData, icon, LOGO, toast } from '../ui.js';

const DEMO = [
  { label: 'Admin', email: 'admin@meditrack.test', password: 'admin123' },
  { label: 'Doctor', email: 'anita.rao@meditrack.test', password: 'doctor123' },
  { label: 'Patient', email: 'johndoe@example.com', password: 'patient123' },
];

export function renderAuth(root, { mode = 'login', onAuthed }) {
  root.innerHTML = `
    <div class="auth">
      <aside class="auth-art">
        <div class="row"><span class="brand-mark" style="background:rgba(255,255,255,.15)">${LOGO}</span>
          <b style="font-size:18px;color:#fff">MediTrack</b></div>
        <div>
          <h1>Patient records and appointments, in one place.</h1>
          <p>Register patients, schedule visits without double-booking, record consultations and prescriptions, and keep everyone informed.</p>
          <ul>
            <li>${icon('calendar')} Conflict-free scheduling with automatic slot allocation</li>
            <li>${icon('stethoscope')} Consultations, diagnoses and digital prescriptions</li>
            <li>${icon('bell')} Reminders and missed-appointment alerts</li>
            <li>${icon('shield')} Role-based access with a full audit trail</li>
          </ul>
        </div>
        <p class="small" style="color:#9fd8cf">Secure sign-in · JWT session</p>
      </aside>
      <main class="auth-form"><div class="auth-box" data-box></div></main>
    </div>`;
  const box = $('[data-box]', root);

  function showLogin() {
    box.innerHTML = `
      <h2>Sign in</h2>
      <p class="muted" style="margin-bottom:22px">Welcome back. Use your MediTrack account.</p>
      <form class="stack" style="gap:14px">
        <label class="field">Email<input name="email" type="email" required autocomplete="username"></label>
        <label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary block" type="submit">Sign in</button>
      </form>
      <p class="small muted" style="margin-top:16px;text-align:center">New patient? <a href="#/register">Create an account</a></p>
      <div class="demo">
        <p class="small"><b>Demo accounts</b> <span class="muted">(after running seed.py)</span></p>
        <div class="demo-btns">${DEMO.map((d, i) => `<button class="btn sm" data-demo="${i}">${esc(d.label)}</button>`).join('')}</div>
      </div>`;
    const form = $('form', box);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await busy($('[type=submit]', form), () => login(formData(form)));
    });
    $$('[data-demo]', box).forEach(b => b.addEventListener('click', () => {
      const d = DEMO[+b.dataset.demo];
      form.email.value = d.email;
      form.password.value = d.password;
      form.requestSubmit();
    }));
    form.email.focus();
  }

  async function login({ email, password }) {
    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      session.set(res.access_token, res.user);
      onAuthed();
    } catch (err) { toast(err.message, 'error'); }
  }

  function showRegister() {
    box.parentElement.style.alignItems = 'start';
    box.style.maxWidth = '640px';
    box.innerHTML = `
      <h2>Create your patient account</h2>
      <p class="muted" style="margin-bottom:22px">Only name, email and password are required — you can complete the rest later.</p>
      <form>${patientFormHtml({}, { password: 'required' })}
        <div class="form-actions" style="justify-content:space-between">
          <a href="#/login" class="btn ghost">Back to sign in</a>
          <button class="btn primary" type="submit">Create account</button>
        </div>
      </form>`;
    const form = $('form', box);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await busy($('[type=submit]', form), async () => {
        try {
          const res = await api('/auth/register', { method: 'POST', body: readPatientForm(form) });
          session.set(res.access_token, res.user);
          toast('Welcome to MediTrack!');
          location.hash = '#/home';
          onAuthed();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  mode === 'register' ? showRegister() : showLogin();
}
