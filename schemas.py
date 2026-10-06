"""Pydantic request/response shapes."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# -------------------------------------------------------------------- auth
class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    name: str
    patient_id: Optional[int] = None
    doctor_id: Optional[int] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------------------------------------------------------- patients
class PatientIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=120)
    phone: Optional[str] = Field(default=None, max_length=20)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    blood_type: Optional[str] = None
    allergies: Optional[str] = None
    medical_history: Optional[str] = None
    chronic_conditions: Optional[str] = None
    current_medications: Optional[str] = None
    address: Optional[str] = Field(default=None, max_length=255)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=120)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=20)
    insurance_provider: Optional[str] = Field(default=None, max_length=120)
    insurance_number: Optional[str] = Field(default=None, max_length=60)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v):
        return v.strip()

    @field_validator("email")
    @classmethod
    def valid_email(cls, v):
        v = v.strip().lower()
        local, _, domain = v.partition("@")
        if not local or "." not in domain:
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def not_in_future(cls, v):
        if v and v > date.today():
            raise ValueError("Date of birth cannot be in the future")
        return v


class PatientRegisterIn(PatientIn):
    """Patient self-registration: a profile plus a login password."""
    password: str = Field(min_length=6)


class PatientCreateIn(PatientIn):
    """Staff registering a patient; a password also creates the patient's login."""
    password: Optional[str] = Field(default=None, min_length=6)


class PatientOut(PatientIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: Optional[datetime] = None
    missing_fields: list[str] = []


class PatientHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    changed_by: Optional[str] = None
    changes: dict
    changed_at: datetime


# ----------------------------------------------------------------- doctors
class DoctorIn(BaseModel):
    name: str = Field(min_length=2)
    specialty: str = Field(min_length=2)
    email: Optional[str] = None


class DoctorCreateIn(DoctorIn):
    """Admin adds a doctor; a password also creates their login."""
    password: Optional[str] = Field(default=None, min_length=6)


class DoctorOut(DoctorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ------------------------------------------------------------ appointments
class AppointmentIn(BaseModel):
    patient_id: int
    doctor_id: int
    slot: datetime
    reason: Optional[str] = Field(default=None, max_length=255)


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
    specialty: Optional[str] = None
    has_consultation: bool = False


# ----------------------------------------------------------- consultations
class PrescriptionItemIn(BaseModel):
    medication: str = Field(min_length=1, max_length=120)
    dosage: Optional[str] = Field(default=None, max_length=60)
    frequency: Optional[str] = Field(default=None, max_length=60)
    duration: Optional[str] = Field(default=None, max_length=60)
    instructions: Optional[str] = Field(default=None, max_length=255)


class PrescriptionItemOut(PrescriptionItemIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ConsultationIn(BaseModel):
    appointment_id: int
    symptoms: Optional[str] = None
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    lab_results: Optional[str] = None
    prescription: Optional[str] = None
    items: list[PrescriptionItemIn] = []
    follow_up: Optional[datetime] = None


class ConsultationOut(BaseModel):
    id: int
    appointment_id: int
    symptoms: Optional[str] = None
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    lab_results: Optional[str] = None
    prescription: Optional[str] = None
    items: list[PrescriptionItemOut] = []
    created_at: datetime
    slot: Optional[datetime] = None
    patient_id: Optional[int] = None
    patient_name: Optional[str] = None
    doctor_id: Optional[int] = None
    doctor_name: Optional[str] = None
    specialty: Optional[str] = None
    follow_up_id: Optional[int] = None


# ------------------------------------------------- notifications and audit
class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: Optional[str] = None
    message: str
    is_read: bool = False
    created_at: datetime


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_email: Optional[str] = None
    action: str
    entity: Optional[str] = None
    entity_id: Optional[int] = None
    details: Optional[str] = None
    ip: Optional[str] = None
    created_at: datetime
