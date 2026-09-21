"""MediTrack prototype API."""
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, create_database_if_missing, engine, get_db

app = FastAPI(title="MediTrack", description="Patient records & appointment prototype")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    create_database_if_missing()
    Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------- patients
@app.get("/api/patients", response_model=list[schemas.PatientOut])
def list_patients(q: str = "", db: Session = Depends(get_db)):
    query = db.query(models.Patient)
    if q:
        query = query.filter(models.Patient.name.like("%{}%".format(q)))
    return query.order_by(models.Patient.id.desc()).all()


@app.post("/api/patients", response_model=schemas.PatientOut, status_code=201)
def create_patient(payload: schemas.PatientIn, db: Session = Depends(get_db)):
    exists = db.query(models.Patient).filter(models.Patient.email == payload.email).first()
    if exists:
        raise HTTPException(400, "A patient with that email already exists")
    patient = models.Patient(**payload.model_dump())
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@app.get("/api/patients/{patient_id}", response_model=schemas.PatientOut)
def get_patient(patient_id: int, db: Session = Depends(get_db)):
    patient = db.get(models.Patient, patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    return patient


# ----------------------------------------------------------------- doctors
@app.get("/api/doctors", response_model=list[schemas.DoctorOut])
def list_doctors(specialty: str = "", db: Session = Depends(get_db)):
    query = db.query(models.Doctor)
    if specialty:
        query = query.filter(models.Doctor.specialty == specialty)
    return query.order_by(models.Doctor.name).all()


@app.post("/api/doctors", response_model=schemas.DoctorOut, status_code=201)
def create_doctor(payload: schemas.DoctorIn, db: Session = Depends(get_db)):
    doctor = models.Doctor(**payload.model_dump())
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    return doctor


# ------------------------------------------------------------ appointments
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
    )


@app.get("/api/appointments", response_model=list[schemas.AppointmentOut])
def list_appointments(status: str = "", db: Session = Depends(get_db)):
    query = db.query(models.Appointment)
    if status:
        query = query.filter(models.Appointment.status == status)
    rows = query.order_by(models.Appointment.slot).all()
    return [_appointment_out(a) for a in rows]


@app.post("/api/appointments", response_model=schemas.AppointmentOut, status_code=201)
def book_appointment(payload: schemas.AppointmentIn, db: Session = Depends(get_db)):
    if not db.get(models.Patient, payload.patient_id):
        raise HTTPException(404, "Patient not found")
    if not db.get(models.Doctor, payload.doctor_id):
        raise HTTPException(404, "Doctor not found")

    # conflict detection: same doctor, same slot, still active
    clash = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.doctor_id == payload.doctor_id,
            models.Appointment.slot == payload.slot,
            models.Appointment.status != "CANCELLED",
        )
        .first()
    )
    if clash:
        raise HTTPException(409, "That doctor is already booked for this slot")

    appt = models.Appointment(**payload.model_dump())
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return _appointment_out(appt)


@app.patch("/api/appointments/{appointment_id}", response_model=schemas.AppointmentOut)
def update_appointment(
    appointment_id: int,
    status: str = "",
    slot: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    """Cancel, complete, or reschedule an appointment."""
    appt = db.get(models.Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if status:
        if status not in ("BOOKED", "COMPLETED", "CANCELLED"):
            raise HTTPException(400, "Unknown status")
        appt.status = status
    if slot:
        appt.slot = slot
    db.commit()
    db.refresh(appt)
    return _appointment_out(appt)


@app.get("/api/doctors/{doctor_id}/slots")
def available_slots(doctor_id: int, day: str = "", db: Session = Depends(get_db)):
    """Hourly slots 09:00-17:00 for a day, minus whatever is already booked."""
    if not db.get(models.Doctor, doctor_id):
        raise HTTPException(404, "Doctor not found")
    target = datetime.strptime(day, "%Y-%m-%d") if day else datetime.now()
    start = target.replace(hour=9, minute=0, second=0, microsecond=0)

    taken = {
        a.slot
        for a in db.query(models.Appointment).filter(
            models.Appointment.doctor_id == doctor_id,
            models.Appointment.status != "CANCELLED",
        )
    }
    slots = []
    for hour in range(8):
        moment = start + timedelta(hours=hour)
        slots.append({"slot": moment.isoformat(), "available": moment not in taken})
    return slots


# ----------------------------------------------------------- consultations
@app.get("/api/consultations", response_model=list[schemas.ConsultationOut])
def list_consultations(patient_id: int = 0, db: Session = Depends(get_db)):
    query = db.query(models.Consultation).join(models.Appointment)
    if patient_id:
        query = query.filter(models.Appointment.patient_id == patient_id)
    rows = query.order_by(models.Consultation.id.desc()).all()
    return [
        schemas.ConsultationOut(
            id=c.id,
            appointment_id=c.appointment_id,
            diagnosis=c.diagnosis,
            notes=c.notes,
            prescription=c.prescription,
            created_at=c.created_at,
            patient_name=c.appointment.patient.name,
            doctor_name=c.appointment.doctor.name,
        )
        for c in rows
    ]


@app.post("/api/consultations", response_model=schemas.ConsultationOut, status_code=201)
def record_consultation(payload: schemas.ConsultationIn, db: Session = Depends(get_db)):
    appt = db.get(models.Appointment, payload.appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    consultation = models.Consultation(**payload.model_dump())
    db.add(consultation)
    appt.status = "COMPLETED"
    db.commit()
    db.refresh(consultation)
    return schemas.ConsultationOut(
        id=consultation.id,
        appointment_id=consultation.appointment_id,
        diagnosis=consultation.diagnosis,
        notes=consultation.notes,
        prescription=consultation.prescription,
        created_at=consultation.created_at,
        patient_name=appt.patient.name,
        doctor_name=appt.doctor.name,
    )


# ------------------------------------------------------------------- stats
@app.get("/api/stats")
def stats(db: Session = Depends(get_db)):
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
    return {
        "patients": db.query(models.Patient).count(),
        "doctors": db.query(models.Doctor).count(),
        "appointments": db.query(models.Appointment).count(),
        "consultations": db.query(models.Consultation).count(),
        "by_status": by_status,
        "by_specialty": by_specialty,
    }


# ---------------------------------------------------------------- frontend
FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
