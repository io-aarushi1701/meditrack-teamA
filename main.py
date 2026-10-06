"""MediTrack API."""
import asyncio
import csv
import io
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
import schemas
from auth import create_token, current_user, hash_password, require, verify_password
from database import SessionLocal, get_db, init_db
from services import audit, fmt_slot, notify_doctor, notify_patient, sweep_appointments

log = logging.getLogger("meditrack")

SWEEP_SECONDS = 300
FIRST_HOUR, LAST_HOUR = 9, 17  # slots run 09:00 - 16:00, one hour each
WORKING_DAYS = range(0, 5)  # Monday - Friday
STAFF = ("ADMIN", "DOCTOR")


def _run_sweep():
    db = SessionLocal()
    try:
        sweep_appointments(db)
    finally:
        db.close()


async def _reminder_loop():
    while True:
        try:
            await asyncio.to_thread(_run_sweep)
        except Exception:
            log.exception("Reminder sweep failed")
        await asyncio.sleep(SWEEP_SECONDS)


@asynccontextmanager
async def lifespan(app):
    init_db()
    task = asyncio.create_task(_reminder_loop())
    yield
    task.cancel()


app = FastAPI(
    title="MediTrack",
    description="Patient health records & appointment management. "
                "Use POST /api/auth/login, then click Authorize and paste the access_token.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ helpers
def _user_out(user):
    return schemas.UserOut(
        id=user.id, email=user.email, role=user.role, name=user.display_name,
        patient_id=user.patient_id, doctor_id=user.doctor_id,
    )


IMPORTANT_FIELDS = {
    "phone": "Phone",
    "date_of_birth": "Date of birth",
    "gender": "Gender",
    "blood_type": "Blood type",
    "allergies": "Allergies",
    "emergency_contact_name": "Emergency contact",
    "emergency_contact_phone": "Emergency contact phone",
    "insurance_provider": "Insurance",
}


def _patient_out(patient):
    out = schemas.PatientOut.model_validate(patient)
    out.missing_fields = [label for field, label in IMPORTANT_FIELDS.items() if not getattr(patient, field)]
    return out


def _can_see_patient(user, patient_id):
    return user.role in STAFF or user.patient_id == patient_id


def _get_patient_for(user, patient_id, db):
    patient = db.get(models.Patient, patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    if not _can_see_patient(user, patient_id):
        raise HTTPException(403, "You can only view your own record")
    return patient


def _appointment_out(appt):
    return schemas.AppointmentOut(
        id=appt.id,
        patient_id=appt.patient_id,
        doctor_id=appt.doctor_id,
        slot=appt.slot,
        reason=appt.reason,
        status=appt.status,
        patient_name=appt.patient.name if appt.patient else None,
        doctor_name=appt.doctor.name if appt.doctor else None,
        specialty=appt.doctor.specialty if appt.doctor else None,
        has_consultation=appt.consultation is not None,
    )


def _consultation_out(c, follow_up_id=None):
    appt = c.appointment
    return schemas.ConsultationOut(
        id=c.id,
        appointment_id=c.appointment_id,
        symptoms=c.symptoms,
        diagnosis=c.diagnosis,
        notes=c.notes,
        lab_results=c.lab_results,
        prescription=c.prescription,
        items=[schemas.PrescriptionItemOut.model_validate(i) for i in c.items],
        created_at=c.created_at,
        slot=appt.slot,
        patient_id=appt.patient_id,
        patient_name=appt.patient.name,
        doctor_id=appt.doctor_id,
        doctor_name=appt.doctor.name,
        specialty=appt.doctor.specialty,
        follow_up_id=follow_up_id,
    )


def _check_slot(db, doctor_id, patient_id, slot, ignore_id=None):
    """Validate a slot and detect clashes for the doctor and the patient."""
    slot = slot.replace(second=0, microsecond=0, tzinfo=None)
    if slot.minute != 0 or not FIRST_HOUR <= slot.hour < LAST_HOUR:
        raise HTTPException(400, "Slots are on the hour between {:02d}:00 and {:02d}:00".format(FIRST_HOUR, LAST_HOUR))
    if slot.weekday() not in WORKING_DAYS:
        raise HTTPException(400, "The clinic is closed on weekends")
    if slot <= datetime.now():
        raise HTTPException(400, "That slot is in the past")

    active = db.query(models.Appointment).filter(
        models.Appointment.slot == slot,
        models.Appointment.status.in_(("BOOKED", "COMPLETED")),
    )
    if ignore_id:
        active = active.filter(models.Appointment.id != ignore_id)
    if active.filter(models.Appointment.doctor_id == doctor_id).first():
        raise HTTPException(409, "That doctor is already booked for this slot")
    if active.filter(models.Appointment.patient_id == patient_id).first():
        raise HTTPException(409, "The patient already has another appointment at this time")
    return slot


def _scoped_appointment(user, appointment_id, db):
    appt = db.get(models.Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if user.role == "DOCTOR" and appt.doctor_id != user.doctor_id:
        raise HTTPException(403, "This appointment belongs to another doctor")
    if user.role == "PATIENT" and appt.patient_id != user.patient_id:
        raise HTTPException(403, "This is not your appointment")
    return appt


# --------------------------------------------------------------------- auth
@app.post("/api/auth/login", response_model=schemas.TokenOut, tags=["auth"])
def login(payload: schemas.LoginIn, request: Request, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        audit(db, email, "LOGIN_FAILED", "user", user.id if user else None, request=request)
        db.commit()
        raise HTTPException(401, "Incorrect email or password")
    audit(db, user, "LOGIN_SUCCESS", "user", user.id, "JWT issued", request=request)
    db.commit()
    return schemas.TokenOut(access_token=create_token(user), user=_user_out(user))


@app.post("/api/auth/register", response_model=schemas.TokenOut, status_code=201, tags=["auth"])
def register(payload: schemas.PatientRegisterIn, request: Request, db: Session = Depends(get_db)):
    """Patient self-registration: creates the patient record and a login."""
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(400, "An account with that email already exists — please sign in")
    if db.query(models.Patient).filter(models.Patient.email == payload.email).first():
        raise HTTPException(400, "This email is already registered at the clinic. Ask the front desk to set up your login.")
    patient = models.Patient(**payload.model_dump(exclude={"password"}))
    db.add(patient)
    db.flush()
    user = models.User(email=payload.email, password_hash=hash_password(payload.password),
                       role="PATIENT", patient_id=patient.id)
    db.add(user)
    db.flush()
    audit(db, user, "PATIENT_SELF_REGISTERED", "patient", patient.id, request=request)
    db.commit()
    db.refresh(user)
    return schemas.TokenOut(access_token=create_token(user), user=_user_out(user))


@app.get("/api/auth/me", response_model=schemas.UserOut, tags=["auth"])
def me(user: models.User = Depends(current_user)):
    return _user_out(user)


# ----------------------------------------------------------------- patients
@app.get("/api/patients", response_model=list[schemas.PatientOut], tags=["patients"])
def list_patients(q: str = "", db: Session = Depends(get_db), user=Depends(require(*STAFF))):
    query = db.query(models.Patient)
    if q:
        like = "%{}%".format(q.strip())
        query = query.filter(or_(
            models.Patient.name.like(like), models.Patient.email.like(like), models.Patient.phone.like(like)
        ))
    return [_patient_out(p) for p in query.order_by(models.Patient.id.desc()).all()]


@app.post("/api/patients", response_model=schemas.PatientOut, status_code=201, tags=["patients"])
def create_patient(
    payload: schemas.PatientCreateIn,
    request: Request,
    allow_duplicate: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require(*STAFF)),
):
    if db.query(models.Patient).filter(models.Patient.email == payload.email).first():
        raise HTTPException(400, "A patient with that email already exists")
    if payload.password and db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(400, "A login with that email already exists")

    if not allow_duplicate:
        # possible duplicate: same name and date of birth, or same name and phone
        same_name = db.query(models.Patient).filter(func.lower(models.Patient.name) == payload.name.lower())
        twin = None
        if payload.date_of_birth:
            twin = same_name.filter(models.Patient.date_of_birth == payload.date_of_birth).first()
        if not twin and payload.phone:
            twin = same_name.filter(models.Patient.phone == payload.phone).first()
        if twin:
            raise HTTPException(409, "Possible duplicate of patient P-{:03d} ({}, {}). Register anyway?".format(
                twin.id, twin.name, twin.email))

    patient = models.Patient(**payload.model_dump(exclude={"password"}))
    db.add(patient)
    db.flush()
    if payload.password:
        db.add(models.User(email=payload.email, password_hash=hash_password(payload.password),
                           role="PATIENT", patient_id=patient.id))
    audit(db, user, "PATIENT_CREATED", "patient", patient.id, patient.name, request=request)
    db.commit()
    db.refresh(patient)
    return _patient_out(patient)


@app.get("/api/patients/{patient_id}", response_model=schemas.PatientOut, tags=["patients"])
def get_patient(patient_id: int, request: Request, db: Session = Depends(get_db), user=Depends(current_user)):
    patient = _get_patient_for(user, patient_id, db)
    if user.role in STAFF:
        audit(db, user, "PATIENT_RECORD_VIEWED", "patient", patient_id, request=request)
        db.commit()
    return _patient_out(patient)


@app.put("/api/patients/{patient_id}", response_model=schemas.PatientOut, tags=["patients"])
def update_patient(
    patient_id: int,
    payload: schemas.PatientIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    """Update a profile; the previous values are kept in the patient's history."""
    patient = _get_patient_for(user, patient_id, db)
    data = payload.model_dump()

    if data["email"] != patient.email:
        taken = db.query(models.Patient).filter(models.Patient.email == data["email"],
                                                models.Patient.id != patient_id).first()
        login_taken = db.query(models.User).filter(models.User.email == data["email"],
                                                   models.User.patient_id != patient_id).first()
        if taken or login_taken:
            raise HTTPException(400, "Another account already uses that email")

    changes = {}
    for field, new in data.items():
        old = getattr(patient, field)
        if (old or None) != (new or None):
            changes[field] = [str(old) if old is not None else None, str(new) if new is not None else None]
            setattr(patient, field, new)
    if not changes:
        return _patient_out(patient)

    if "email" in changes:
        for login_user in db.query(models.User).filter_by(patient_id=patient_id):
            login_user.email = data["email"]
    db.add(models.PatientHistory(patient_id=patient_id, changed_by=user.email, changes=json.dumps(changes)))
    audit(db, user, "PATIENT_UPDATED", "patient", patient_id, ", ".join(changes), request=request)
    db.commit()
    db.refresh(patient)
    return _patient_out(patient)


@app.get("/api/patients/{patient_id}/history", response_model=list[schemas.PatientHistoryOut], tags=["patients"])
def patient_history(patient_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    patient = _get_patient_for(user, patient_id, db)
    return [
        schemas.PatientHistoryOut(id=h.id, changed_by=h.changed_by, changes=json.loads(h.changes),
                                  changed_at=h.changed_at)
        for h in patient.history
    ]


# ------------------------------------------------------------------ doctors
@app.get("/api/doctors", response_model=list[schemas.DoctorOut], tags=["doctors"])
def list_doctors(specialty: str = "", q: str = "", db: Session = Depends(get_db), user=Depends(current_user)):
    query = db.query(models.Doctor)
    if specialty:
        query = query.filter(models.Doctor.specialty == specialty)
    if q:
        like = "%{}%".format(q.strip())
        query = query.filter(or_(models.Doctor.name.like(like), models.Doctor.specialty.like(like)))
    return query.order_by(models.Doctor.name).all()


@app.get("/api/specialties", response_model=list[str], tags=["doctors"])
def specialties(db: Session = Depends(get_db), user=Depends(current_user)):
    return [s for (s,) in db.query(models.Doctor.specialty).distinct().order_by(models.Doctor.specialty)]


@app.post("/api/doctors", response_model=schemas.DoctorOut, status_code=201, tags=["doctors"])
def create_doctor(
    payload: schemas.DoctorCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require("ADMIN")),
):
    email = payload.email.strip().lower() if payload.email else None
    if payload.password:
        if not email:
            raise HTTPException(400, "An email is required to create the doctor's login")
        if db.query(models.User).filter(models.User.email == email).first():
            raise HTTPException(400, "A login with that email already exists")
    doctor = models.Doctor(name=payload.name.strip(), specialty=payload.specialty.strip(), email=email)
    db.add(doctor)
    db.flush()
    if payload.password:
        db.add(models.User(email=email, password_hash=hash_password(payload.password),
                           role="DOCTOR", doctor_id=doctor.id))
    audit(db, user, "DOCTOR_CREATED", "doctor", doctor.id, doctor.name, request=request)
    db.commit()
    db.refresh(doctor)
    return doctor


def _patient_busy(db, user, patient_id, start, end):
    """Slots where the patient already has an appointment (any doctor)."""
    if user.role == "PATIENT":
        patient_id = user.patient_id
    if not patient_id:
        return set()
    return {
        a.slot
        for a in db.query(models.Appointment).filter(
            models.Appointment.patient_id == patient_id,
            models.Appointment.status.in_(("BOOKED", "COMPLETED")),
            models.Appointment.slot >= start,
            models.Appointment.slot < end,
        )
    }


@app.get("/api/doctors/{doctor_id}/slots", tags=["appointments"])
def available_slots(
    doctor_id: int,
    day: str = "",
    patient_id: int = 0,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    """Hourly slots 09:00-17:00 for a day; with patient_id, the patient's own bookings show as busy."""
    if not db.get(models.Doctor, doctor_id):
        raise HTTPException(404, "Doctor not found")
    try:
        target = datetime.strptime(day, "%Y-%m-%d") if day else datetime.now()
    except ValueError:
        raise HTTPException(400, "day must be YYYY-MM-DD")
    start = target.replace(hour=FIRST_HOUR, minute=0, second=0, microsecond=0)
    end = target.replace(hour=LAST_HOUR, minute=0, second=0, microsecond=0)

    taken = {
        a.slot
        for a in db.query(models.Appointment).filter(
            models.Appointment.doctor_id == doctor_id,
            models.Appointment.status.in_(("BOOKED", "COMPLETED")),
            models.Appointment.slot >= start,
            models.Appointment.slot < end,
        )
    }
    busy = _patient_busy(db, user, patient_id, start, end)
    now = datetime.now()
    closed = start.weekday() not in WORKING_DAYS
    slots = []
    for hour in range(LAST_HOUR - FIRST_HOUR):
        moment = start + timedelta(hours=hour)
        if closed:
            state = "closed"
        elif moment in taken:
            state = "booked"
        elif moment <= now:
            state = "past"
        elif moment in busy:
            state = "busy"
        else:
            state = "free"
        slots.append({"slot": moment.isoformat(), "available": state == "free", "state": state})
    return slots


@app.get("/api/doctors/{doctor_id}/next-available", tags=["appointments"])
def next_available(doctor_id: int, patient_id: int = 0, db: Session = Depends(get_db), user=Depends(current_user)):
    """Automatic slot allocation: the earliest free slot in the next 30 days."""
    if not db.get(models.Doctor, doctor_id):
        raise HTTPException(404, "Doctor not found")
    now = datetime.now()
    horizon = now + timedelta(days=30)
    taken = {
        a.slot
        for a in db.query(models.Appointment).filter(
            models.Appointment.doctor_id == doctor_id,
            models.Appointment.status.in_(("BOOKED", "COMPLETED")),
            models.Appointment.slot > now,
            models.Appointment.slot <= horizon,
        )
    }
    taken |= _patient_busy(db, user, patient_id, now, horizon)
    day = now.replace(minute=0, second=0, microsecond=0)
    while day <= horizon:
        for hour in (range(FIRST_HOUR, LAST_HOUR) if day.weekday() in WORKING_DAYS else ()):
            moment = day.replace(hour=hour)
            if moment > now and moment not in taken:
                return {"slot": moment.isoformat()}
        day = (day + timedelta(days=1)).replace(hour=0)
    raise HTTPException(404, "No free slot in the next 30 days")


# ------------------------------------------------------------- appointments
@app.get("/api/appointments", response_model=list[schemas.AppointmentOut], tags=["appointments"])
def list_appointments(
    status: str = "",
    patient_id: int = 0,
    doctor_id: int = 0,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    query = db.query(models.Appointment)
    if user.role == "DOCTOR":
        doctor_id = user.doctor_id
    elif user.role == "PATIENT":
        patient_id = user.patient_id
    if status:
        query = query.filter(models.Appointment.status == status)
    if patient_id:
        query = query.filter(models.Appointment.patient_id == patient_id)
    if doctor_id:
        query = query.filter(models.Appointment.doctor_id == doctor_id)
    if date_from:
        query = query.filter(models.Appointment.slot >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(models.Appointment.slot < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    rows = query.order_by(models.Appointment.slot).all()
    return [_appointment_out(a) for a in rows]


@app.get("/api/appointments/{appointment_id}", response_model=schemas.AppointmentOut, tags=["appointments"])
def get_appointment(appointment_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    return _appointment_out(_scoped_appointment(user, appointment_id, db))


@app.post("/api/appointments", response_model=schemas.AppointmentOut, status_code=201, tags=["appointments"])
def book_appointment(
    payload: schemas.AppointmentIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    if user.role == "PATIENT" and payload.patient_id != user.patient_id:
        raise HTTPException(403, "You can only book appointments for yourself")
    patient = db.get(models.Patient, payload.patient_id)
    doctor = db.get(models.Doctor, payload.doctor_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    if not doctor:
        raise HTTPException(404, "Doctor not found")

    slot = _check_slot(db, payload.doctor_id, payload.patient_id, payload.slot)
    appt = models.Appointment(patient_id=patient.id, doctor_id=doctor.id, slot=slot,
                              reason=payload.reason, status="BOOKED")
    db.add(appt)
    db.flush()
    when = fmt_slot(slot)
    notify_patient(db, patient.id, "BOOKED", "Appointment booked with {} on {}".format(doctor.name, when))
    notify_doctor(db, doctor.id, "BOOKED", "New appointment: {} on {}".format(patient.name, when))
    audit(db, user, "APPOINTMENT_BOOKED", "appointment", appt.id,
          "{} with {} at {}".format(patient.name, doctor.name, when), request=request)
    db.commit()
    db.refresh(appt)
    return _appointment_out(appt)


@app.patch("/api/appointments/{appointment_id}", response_model=schemas.AppointmentOut, tags=["appointments"])
def update_appointment(
    appointment_id: int,
    request: Request,
    status: str = "",
    slot: Optional[datetime] = None,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    """Cancel, complete, or reschedule an appointment."""
    appt = _scoped_appointment(user, appointment_id, db)

    if slot:
        if appt.status != "BOOKED":
            raise HTTPException(400, "Only booked appointments can be rescheduled")
        old = fmt_slot(appt.slot)
        appt.slot = _check_slot(db, appt.doctor_id, appt.patient_id, slot, ignore_id=appt.id)
        appt.reminder_sent = False
        msg = "Appointment with {} moved from {} to {}".format(appt.doctor.name, old, fmt_slot(appt.slot))
        notify_patient(db, appt.patient_id, "RESCHEDULED", msg)
        notify_doctor(db, appt.doctor_id, "RESCHEDULED",
                      "{} rescheduled from {} to {}".format(appt.patient.name, old, fmt_slot(appt.slot)))
        audit(db, user, "APPOINTMENT_RESCHEDULED", "appointment", appt.id, msg, request=request)

    if status and status != appt.status:
        if status not in ("BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"):
            raise HTTPException(400, "Unknown status")
        if user.role == "PATIENT" and status != "CANCELLED":
            raise HTTPException(403, "Patients can only cancel appointments")
        if status == "CANCELLED" and appt.status != "BOOKED":
            raise HTTPException(400, "Only booked appointments can be cancelled")
        if status == "BOOKED":
            _check_slot(db, appt.doctor_id, appt.patient_id, appt.slot, ignore_id=appt.id)
        appt.status = status
        if status == "CANCELLED":
            when = fmt_slot(appt.slot)
            notify_patient(db, appt.patient_id, "CANCELLED",
                           "Appointment with {} on {} was cancelled".format(appt.doctor.name, when))
            notify_doctor(db, appt.doctor_id, "CANCELLED",
                          "{} on {} was cancelled".format(appt.patient.name, when))
        audit(db, user, "APPOINTMENT_" + status, "appointment", appt.id, request=request)

    db.commit()
    db.refresh(appt)
    return _appointment_out(appt)


# ------------------------------------------------------------ consultations
@app.get("/api/consultations", response_model=list[schemas.ConsultationOut], tags=["consultations"])
def list_consultations(
    patient_id: int = 0,
    appointment_id: int = 0,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    query = db.query(models.Consultation).join(models.Appointment)
    if user.role == "PATIENT":
        patient_id = user.patient_id
    if patient_id:
        query = query.filter(models.Appointment.patient_id == patient_id)
    if appointment_id:
        query = query.filter(models.Consultation.appointment_id == appointment_id)
    rows = query.order_by(models.Appointment.slot.desc()).all()
    return [_consultation_out(c) for c in rows]


@app.get("/api/consultations/{consultation_id}", response_model=schemas.ConsultationOut, tags=["consultations"])
def get_consultation(consultation_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    c = db.get(models.Consultation, consultation_id)
    if not c:
        raise HTTPException(404, "Consultation not found")
    if not _can_see_patient(user, c.appointment.patient_id):
        raise HTTPException(403, "You can only view your own records")
    return _consultation_out(c)


def _apply_consultation(c, payload):
    for field in ("symptoms", "diagnosis", "notes", "lab_results", "prescription"):
        setattr(c, field, getattr(payload, field))
    c.items = [models.PrescriptionItem(**item.model_dump()) for item in payload.items]


@app.post("/api/consultations", response_model=schemas.ConsultationOut, status_code=201, tags=["consultations"])
def record_consultation(
    payload: schemas.ConsultationIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require("DOCTOR")),
):
    """Record diagnosis + prescription; marks the appointment COMPLETED, optionally books a follow-up."""
    appt = _scoped_appointment(user, payload.appointment_id, db)
    if appt.status == "CANCELLED":
        raise HTTPException(400, "This appointment was cancelled")
    if appt.consultation:
        raise HTTPException(400, "A consultation is already recorded for this appointment — edit it instead")

    follow_slot = None
    if payload.follow_up:
        follow_slot = _check_slot(db, appt.doctor_id, appt.patient_id, payload.follow_up)

    consultation = models.Consultation(appointment_id=appt.id)
    _apply_consultation(consultation, payload)
    db.add(consultation)
    appt.status = "COMPLETED"

    follow_up = None
    if follow_slot:
        follow_up = models.Appointment(
            patient_id=appt.patient_id, doctor_id=appt.doctor_id, slot=follow_slot, status="BOOKED",
            reason="Follow-up: {}".format(payload.diagnosis or appt.reason or "review")[:255],
        )
        db.add(follow_up)
        notify_patient(db, appt.patient_id, "FOLLOW_UP",
                       "Follow-up booked with {} on {}".format(appt.doctor.name, fmt_slot(follow_slot)))
    if payload.items:
        notify_patient(db, appt.patient_id, "PRESCRIPTION",
                       "New prescription from {}: {}".format(
                           appt.doctor.name, ", ".join(i.medication for i in payload.items))[:255])
    db.flush()
    audit(db, user, "CONSULTATION_RECORDED", "consultation", consultation.id,
          "{}: {}".format(appt.patient.name, payload.diagnosis or ""), request=request)
    db.commit()
    db.refresh(consultation)
    return _consultation_out(consultation, follow_up.id if follow_up else None)


@app.put("/api/consultations/{consultation_id}", response_model=schemas.ConsultationOut, tags=["consultations"])
def update_consultation(
    consultation_id: int,
    payload: schemas.ConsultationIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require("DOCTOR")),
):
    c = db.get(models.Consultation, consultation_id)
    if not c:
        raise HTTPException(404, "Consultation not found")
    if c.appointment.doctor_id != user.doctor_id:
        raise HTTPException(403, "Only the treating doctor can edit this consultation")
    _apply_consultation(c, payload)
    audit(db, user, "CONSULTATION_UPDATED", "consultation", c.id, request=request)
    db.commit()
    db.refresh(c)
    return _consultation_out(c)


# ------------------------------------------------------------ notifications
@app.get("/api/notifications", tags=["notifications"])
def list_notifications(db: Session = Depends(get_db), user=Depends(current_user)):
    sweep_appointments(db)
    base = db.query(models.Notification).filter(models.Notification.user_id == user.id)
    unread = base.filter(or_(models.Notification.is_read.is_(False), models.Notification.is_read.is_(None))).count()
    items = base.order_by(models.Notification.id.desc()).limit(50).all()
    return {"unread": unread, "items": [schemas.NotificationOut.model_validate(n) for n in items]}


@app.post("/api/notifications/read-all", tags=["notifications"])
def read_all_notifications(db: Session = Depends(get_db), user=Depends(current_user)):
    db.query(models.Notification).filter(models.Notification.user_id == user.id).update({"is_read": True})
    db.commit()
    return {"ok": True}


@app.post("/api/notifications/{notification_id}/read", tags=["notifications"])
def read_notification(notification_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    n = db.get(models.Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


# -------------------------------------------------------------------- audit
@app.get("/api/audit", response_model=list[schemas.AuditOut], tags=["admin"])
def audit_log(action: str = "", limit: int = 200, db: Session = Depends(get_db), user=Depends(require("ADMIN"))):
    query = db.query(models.AuditLog)
    if action:
        query = query.filter(models.AuditLog.action.like("%{}%".format(action)))
    return query.order_by(models.AuditLog.id.desc()).limit(min(limit, 1000)).all()


# -------------------------------------------------------------------- stats
def _age(dob, today):
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


@app.get("/api/stats", tags=["admin"])
def stats(db: Session = Depends(get_db), user=Depends(require("ADMIN"))):
    today = date.today()
    now = datetime.now()

    by_status = dict(
        db.query(models.Appointment.status, func.count(models.Appointment.id))
        .group_by(models.Appointment.status)
        .all()
    )
    by_specialty = dict(
        db.query(models.Doctor.specialty, func.count(models.Appointment.id))
        .join(models.Appointment, models.Appointment.doctor_id == models.Doctor.id)
        .group_by(models.Doctor.specialty)
        .all()
    )

    # last 6 calendar months, oldest first
    months = []
    y, m = today.year, today.month
    for _ in range(6):
        months.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    months.reverse()
    trend = {"{}-{:02d}".format(y, m): {"BOOKED": 0, "COMPLETED": 0, "CANCELLED": 0, "NO_SHOW": 0}
             for y, m in months}
    first_y, first_m = months[0]
    for slot, status in db.query(models.Appointment.slot, models.Appointment.status).filter(
            models.Appointment.slot >= datetime(first_y, first_m, 1)):
        key = "{}-{:02d}".format(slot.year, slot.month)
        if key in trend and status in trend[key]:
            trend[key][status] += 1

    gender, ages = {}, {"0-17": 0, "18-34": 0, "35-49": 0, "50-64": 0, "65+": 0, "Unknown": 0}
    for g, dob in db.query(models.Patient.gender, models.Patient.date_of_birth):
        gender[g or "Unspecified"] = gender.get(g or "Unspecified", 0) + 1
        if not dob:
            ages["Unknown"] += 1
            continue
        a = _age(dob, today)
        bucket = "0-17" if a < 18 else "18-34" if a < 35 else "35-49" if a < 50 else "50-64" if a < 65 else "65+"
        ages[bucket] += 1

    doctors = []
    for d in db.query(models.Doctor).order_by(models.Doctor.name):
        appts = d.appointments
        done = [a for a in appts if a.status == "COMPLETED"]
        doctors.append({
            "id": d.id,
            "name": d.name,
            "specialty": d.specialty,
            "appointments": len(appts),
            "completed": len(done),
            "no_shows": sum(1 for a in appts if a.status == "NO_SHOW"),
            "patients": len({a.patient_id for a in done}),
            "upcoming": sum(1 for a in appts if a.status == "BOOKED" and a.slot > now),
        })

    start_today = datetime.combine(today, datetime.min.time())
    return {
        "patients": db.query(models.Patient).count(),
        "doctors": db.query(models.Doctor).count(),
        "appointments": db.query(models.Appointment).count(),
        "consultations": db.query(models.Consultation).count(),
        "today": db.query(models.Appointment).filter(
            models.Appointment.slot >= start_today,
            models.Appointment.slot < start_today + timedelta(days=1),
            models.Appointment.status != "CANCELLED").count(),
        "upcoming": db.query(models.Appointment).filter(
            models.Appointment.slot > now, models.Appointment.status == "BOOKED").count(),
        "new_patients_30d": db.query(models.Patient).filter(
            models.Patient.created_at >= now - timedelta(days=30)).count(),
        "by_status": by_status,
        "by_specialty": by_specialty,
        "trend": trend,
        "gender": gender,
        "ages": ages,
        "doctor_report": doctors,
    }


# ------------------------------------------------------------------- export
EXPORTS = {
    "patients": (
        ["id", "name", "email", "phone", "date_of_birth", "gender", "blood_type", "allergies",
         "chronic_conditions", "insurance_provider", "created_at"],
        lambda db: [[p.id, p.name, p.email, p.phone, p.date_of_birth, p.gender, p.blood_type, p.allergies,
                     p.chronic_conditions, p.insurance_provider, p.created_at]
                    for p in db.query(models.Patient).order_by(models.Patient.id)],
    ),
    "appointments": (
        ["id", "slot", "status", "patient", "doctor", "specialty", "reason"],
        lambda db: [[a.id, a.slot, a.status, a.patient.name, a.doctor.name, a.doctor.specialty, a.reason]
                    for a in db.query(models.Appointment).order_by(models.Appointment.slot)],
    ),
    "consultations": (
        ["id", "date", "patient", "doctor", "symptoms", "diagnosis", "medications", "advice"],
        lambda db: [[c.id, c.appointment.slot, c.appointment.patient.name, c.appointment.doctor.name,
                     c.symptoms, c.diagnosis,
                     "; ".join(" ".join(filter(None, [i.medication, i.dosage, i.frequency, i.duration]))
                               for i in c.items),
                     c.prescription]
                    for c in db.query(models.Consultation).order_by(models.Consultation.id)],
    ),
}


@app.get("/api/export/{kind}", tags=["admin"])
def export_csv(kind: str, request: Request, db: Session = Depends(get_db), user=Depends(require("ADMIN"))):
    if kind not in EXPORTS:
        raise HTTPException(404, "Unknown export")
    header, rows = EXPORTS[kind]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows(db))
    audit(db, user, "DATA_EXPORTED", kind, details="CSV", request=request)
    db.commit()
    filename = "meditrack-{}-{}.csv".format(kind, date.today().isoformat())
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="{}"'.format(filename)})


# ----------------------------------------------------------------- frontend
FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
