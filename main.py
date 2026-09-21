"""Milestone 2: patients, doctors, and conflict-safe appointment booking."""
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
from sqlalchemy import DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

engine = create_engine("sqlite:///./meditrack.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
class Base(DeclarativeBase): pass
class Patient(Base):
    __tablename__="patients"; id: Mapped[int]=mapped_column(primary_key=True); name: Mapped[str]=mapped_column(String(120)); email: Mapped[str]=mapped_column(String(120),unique=True)
class Doctor(Base):
    __tablename__="doctors"; id: Mapped[int]=mapped_column(primary_key=True); name: Mapped[str]=mapped_column(String(120)); specialty: Mapped[str]=mapped_column(String(80))
class Appointment(Base):
    __tablename__="appointments"; id: Mapped[int]=mapped_column(primary_key=True); patient_id: Mapped[int]=mapped_column(ForeignKey("patients.id")); doctor_id: Mapped[int]=mapped_column(ForeignKey("doctors.id")); slot: Mapped[datetime]=mapped_column(DateTime); reason: Mapped[Optional[str]]=mapped_column(String(255)); status: Mapped[str]=mapped_column(String(20),default="BOOKED"); patient: Mapped[Patient]=relationship(); doctor: Mapped[Doctor]=relationship()
class PatientIn(BaseModel): name:str; email:str
class DoctorIn(BaseModel): name:str; specialty:str
class AppointmentIn(BaseModel): patient_id:int; doctor_id:int; slot:datetime; reason:Optional[str]=None
class PatientOut(PatientIn): model_config=ConfigDict(from_attributes=True); id:int
class DoctorOut(DoctorIn): model_config=ConfigDict(from_attributes=True); id:int
class AppointmentOut(BaseModel): id:int; patient_id:int; doctor_id:int; slot:datetime; reason:Optional[str]; status:str; patient_name:str; doctor_name:str
app=FastAPI(title="MediTrack — Milestone 2")
@app.on_event("startup")
def start(): Base.metadata.create_all(engine)
def db():
    session=SessionLocal()
    try: yield session
    finally: session.close()
def out(a): return AppointmentOut(id=a.id,patient_id=a.patient_id,doctor_id=a.doctor_id,slot=a.slot,reason=a.reason,status=a.status,patient_name=a.patient.name,doctor_name=a.doctor.name)
@app.get("/api/patients",response_model=list[PatientOut])
def patients(session:Session=Depends(db)): return session.query(Patient).all()
@app.post("/api/patients",response_model=PatientOut)
def add_patient(p:PatientIn,session:Session=Depends(db)):
    if session.query(Patient).filter_by(email=p.email).first(): raise HTTPException(400,"Email already registered")
    item=Patient(**p.model_dump());session.add(item);session.commit();session.refresh(item);return item
@app.get("/api/doctors",response_model=list[DoctorOut])
def doctors(session:Session=Depends(db)): return session.query(Doctor).all()
@app.post("/api/doctors",response_model=DoctorOut)
def add_doctor(d:DoctorIn,session:Session=Depends(db)): item=Doctor(**d.model_dump());session.add(item);session.commit();session.refresh(item);return item
@app.get("/api/appointments",response_model=list[AppointmentOut])
def appointments(session:Session=Depends(db)): return [out(a) for a in session.query(Appointment).order_by(Appointment.slot).all()]
@app.post("/api/appointments",response_model=AppointmentOut)
def book(a:AppointmentIn,session:Session=Depends(db)):
    if not session.get(Patient,a.patient_id) or not session.get(Doctor,a.doctor_id): raise HTTPException(404,"Patient or doctor not found")
    if session.query(Appointment).filter_by(doctor_id=a.doctor_id,slot=a.slot,status="BOOKED").first(): raise HTTPException(409,"Doctor already booked for this slot")
    item=Appointment(**a.model_dump());session.add(item);session.commit();session.refresh(item);return out(item)
app.mount("/",StaticFiles(directory=Path(__file__).parent/"frontend",html=True),name="frontend")
