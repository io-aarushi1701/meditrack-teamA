"""Pydantic request/response shapes."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class PatientIn(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    blood_type: Optional[str] = None
    allergies: Optional[str] = None
    medical_history: Optional[str] = None


class PatientOut(PatientIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class DoctorIn(BaseModel):
    name: str
    specialty: str
    email: Optional[str] = None


class DoctorOut(DoctorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AppointmentIn(BaseModel):
    patient_id: int
    doctor_id: int
    slot: datetime
    reason: Optional[str] = None


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    patient_id: int
    doctor_id: int
    slot: datetime
    reason: Optional[str] = None
    status: str
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None


class ConsultationIn(BaseModel):
    appointment_id: int
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    prescription: Optional[str] = None


class ConsultationOut(ConsultationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None
