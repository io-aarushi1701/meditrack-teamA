# MediTrack

Patient health records and appointment management: **FastAPI + MySQL + plain HTML/CSS/JS** (no build step).

## Stack

| Layer    | Choice                                                     |
|----------|------------------------------------------------------------|
| API      | FastAPI + Uvicorn, JWT auth (PyJWT), role-based access     |
| ORM      | SQLAlchemy 2 + PyMySQL                                     |
| Database | MySQL (SQLite also works via `DATABASE_URL`)               |
| Frontend | Static HTML/CSS/vanilla JS modules, served by FastAPI      |

## Setup

Requires Python 3.10+ (tested on 3.14).

```bash
cd meditrack
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env      # then set MYSQL_USER / MYSQL_PASSWORD and JWT_SECRET
```

The app creates the `meditrack` database and its tables on startup, so the MySQL
user only needs permission to `CREATE DATABASE`. If you already have tables from the
earlier prototype, new columns and tables are added automatically and existing data is kept.

No MySQL handy? Put `DATABASE_URL=sqlite:///meditrack.db` in `.env`.

## Run

```bash
cd backend
../.venv/bin/python seed.py                       # demo logins, doctors, patients, 6 months of history
../.venv/bin/uvicorn main:app --reload --port 8000
```

- UI: <http://127.0.0.1:8000>
- Swagger docs: <http://127.0.0.1:8000/docs> (log in via `POST /api/auth/login`, then **Authorize** with the token)

### Demo logins (created by `seed.py`)

| Role    | Email                         | Password     |
|---------|-------------------------------|--------------|
| Admin   | `admin@meditrack.test`        | `admin123`   |
| Doctor  | `anita.rao@meditrack.test` (or any seeded doctor) | `doctor123` |
| Patient | `johndoe@example.com` (or any seeded patient)     | `patient123` |

Patients can also self-register from the sign-in page.

## What each role can do

| Role    | Screens |
|---------|---------|
| Admin   | Dashboard (stats, monthly trend, specialty and demographic charts, doctor performance, CSV export) · Patients (search, register, edit, full record with history) · Appointments (filter, book, reschedule, cancel) · Doctors (add, with optional login) · Audit log |
| Doctor  | Weekly calendar and today's queue · Consultation form (symptoms, diagnosis, notes, lab results, structured prescription, optional follow-up booking) · Patient records · Own appointments |
| Patient | Home overview · Book appointment (search by specialty, slot grid, "earliest available") · My appointments (reschedule/cancel) · Health history and all prescriptions · Profile editing |

Every role gets in-app notifications (bell icon) and printable prescriptions.

## Features mapped to the spec

- **Patient registration & records**: validated forms and REST API; demographics, allergies, chronic conditions, medications, insurance, emergency contact; duplicate detection (email, or same name + DOB/phone); incomplete-record warnings; every edit is stored in `patient_history` with old and new values.
- **Scheduling**: hourly slots 09:00–17:00, Mon–Fri; conflict detection for both doctor and patient (on booking *and* rescheduling); past and weekend slots are rejected; automatic "next available slot"; follow-up booking from a consultation.
- **Consultations & prescriptions**: one consultation per appointment (the treating doctor can edit it); prescription line items (medication, dosage, frequency, duration, instructions); full history; print or save as PDF.
- **Notifications**: in-app messages for booking, rescheduling, cancellation, new prescription and follow-up; a background sweep every 5 minutes sends **24-hour reminders** and marks appointments not attended within 1 hour as **NO_SHOW** with alerts. Set `SMTP_*` in `.env` to also email them.
- **Security**: JWT bearer tokens, PBKDF2-hashed passwords, role checks on every endpoint (patients only ever see their own data), audit log of sign-ins (including failures), record views, changes and exports.
- **Analytics**: admin dashboard plus CSV export of patients, appointments and consultations.

Not built: SMS, Docker, CI/CD, field-level encryption at rest, waiting lists.

## Tables

`patients`, `patient_history`, `doctors`, `users`, `appointments` (`BOOKED`/`COMPLETED`/`CANCELLED`/`NO_SHOW`),
`consultations`, `prescription_items`, `notifications`, `audit_logs`.

## Main endpoints

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/api/auth/login` | anyone | Returns a JWT |
| POST | `/api/auth/register` | anyone | Patient self-registration |
| GET | `/api/auth/me` | signed in | Current user |
| GET/POST | `/api/patients` | staff | Search / register (`?allow_duplicate=true` to override the duplicate check) |
| GET/PUT | `/api/patients/{id}` | staff, or that patient | Read / update a record |
| GET | `/api/patients/{id}/history` | staff, or that patient | Change history |
| GET/POST | `/api/doctors` | all / admin | List (`?specialty=&q=`) / add |
| GET | `/api/specialties` | signed in | Distinct specialties |
| GET | `/api/doctors/{id}/slots?day=` | signed in | Slots with state `free`/`booked`/`past`/`closed` |
| GET | `/api/doctors/{id}/next-available` | signed in | Earliest free slot |
| GET/POST | `/api/appointments` | scoped by role | List (`status`, `date_from`, `date_to`, …) / book |
| GET/PATCH | `/api/appointments/{id}` | scoped by role | Read / `?status=` or `?slot=` |
| GET/POST | `/api/consultations` | scoped / doctor | History / record (marks appointment completed) |
| GET/PUT | `/api/consultations/{id}` | scoped / treating doctor | Read / edit |
| GET | `/api/notifications` | signed in | Latest 50 plus unread count |
| POST | `/api/notifications/{id}/read`, `/read-all` | signed in | Mark as read |
| GET | `/api/stats` | admin | Dashboard data |
| GET | `/api/audit` | admin | Audit log |
| GET | `/api/export/{patients\|appointments\|consultations}` | admin | CSV download |
