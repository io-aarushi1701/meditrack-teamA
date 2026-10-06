"""SQLAlchemy tables."""
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(120), nullable=False)
    email = Column(String(120), unique=True, nullable=False)
    phone = Column(String(20))
    date_of_birth = Column(Date)
    gender = Column(String(20))
    blood_type = Column(String(5))
    allergies = Column(Text)
    medical_history = Column(Text)
    chronic_conditions = Column(Text)
    current_medications = Column(Text)
    address = Column(String(255))
    emergency_contact_name = Column(String(120))
    emergency_contact_phone = Column(String(20))
    insurance_provider = Column(String(120))
    insurance_number = Column(String(60))
    created_at = Column(DateTime, default=datetime.now)

    appointments = relationship("Appointment", back_populates="patient")
    history = relationship("PatientHistory", back_populates="patient", order_by="PatientHistory.id.desc()")


class PatientHistory(Base):
    """Previous values of a patient record, kept every time it is edited."""
    __tablename__ = "patient_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    changed_by = Column(String(120))
    changes = Column(Text)  # JSON: {field: [old, new]}
    changed_at = Column(DateTime, default=datetime.now)

    patient = relationship("Patient", back_populates="history")


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(120), nullable=False)
    specialty = Column(String(80), nullable=False)
    email = Column(String(120))

    appointments = relationship("Appointment", back_populates="doctor")


class User(Base):
    """Login account. A PATIENT or DOCTOR user is linked to its patient/doctor row."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # ADMIN | DOCTOR | PATIENT
    patient_id = Column(Integer, ForeignKey("patients.id"))
    doctor_id = Column(Integer, ForeignKey("doctors.id"))
    created_at = Column(DateTime, default=datetime.now)

    patient = relationship("Patient")
    doctor = relationship("Doctor")

    @property
    def display_name(self):
        if self.patient:
            return self.patient.name
        if self.doctor:
            return self.doctor.name
        return "Administrator"


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False)
    slot = Column(DateTime, nullable=False)
    reason = Column(String(255))
    status = Column(String(20), default="BOOKED")  # BOOKED | COMPLETED | CANCELLED | NO_SHOW
    reminder_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)

    patient = relationship("Patient", back_populates="appointments")
    doctor = relationship("Doctor", back_populates="appointments")
    consultation = relationship("Consultation", back_populates="appointment", uselist=False)


class Consultation(Base):
    __tablename__ = "consultations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=False)
    symptoms = Column(Text)
    diagnosis = Column(Text)
    notes = Column(Text)
    lab_results = Column(Text)
    prescription = Column(Text)  # general advice / instructions
    created_at = Column(DateTime, default=datetime.now)

    appointment = relationship("Appointment", back_populates="consultation")
    items = relationship("PrescriptionItem", back_populates="consultation", cascade="all, delete-orphan")


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    consultation_id = Column(Integer, ForeignKey("consultations.id"), nullable=False)
    medication = Column(String(120), nullable=False)
    dosage = Column(String(60))
    frequency = Column(String(60))
    duration = Column(String(60))
    instructions = Column(String(255))

    consultation = relationship("Consultation", back_populates="items")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String(30))  # BOOKED | CANCELLED | RESCHEDULED | REMINDER | MISSED | PRESCRIPTION | FOLLOW_UP
    message = Column(String(255), nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_email = Column(String(120))
    action = Column(String(60), nullable=False)
    entity = Column(String(40))
    entity_id = Column(Integer)
    details = Column(String(500))
    ip = Column(String(45))
    created_at = Column(DateTime, default=datetime.now)
