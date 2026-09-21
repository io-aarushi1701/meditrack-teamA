"""Milestone 3 backend increment to add after the milestone-2 appointment model."""
from datetime import datetime
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

# Add this model to the milestone-2 SQLAlchemy model module.
class Consultation(Base):
    __tablename__ = "consultations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"))
    diagnosis: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    prescription: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    appointment: Mapped["Appointment"] = relationship()

class ConsultationIn(BaseModel):
    appointment_id: int
    diagnosis: Optional[str] = None
    notes: Optional[str] = None
    prescription: Optional[str] = None

class ConsultationOut(ConsultationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    patient_name: str
    doctor_name: str

def consultation_out(item):
    return ConsultationOut(
        id=item.id, appointment_id=item.appointment_id, diagnosis=item.diagnosis,
        notes=item.notes, prescription=item.prescription, created_at=item.created_at,
        patient_name=item.appointment.patient.name, doctor_name=item.appointment.doctor.name,
    )

# Register these routes on the Milestone 2 FastAPI `app`.
@app.get("/api/consultations", response_model=list[ConsultationOut])
def list_consultations(patient_id: int = 0, session: Session = Depends(db)):
    query = session.query(Consultation).join(Appointment)
    if patient_id:
        query = query.filter(Appointment.patient_id == patient_id)
    return [consultation_out(item) for item in query.order_by(Consultation.id.desc())]

@app.post("/api/consultations", response_model=ConsultationOut, status_code=201)
def record_consultation(payload: ConsultationIn, session: Session = Depends(db)):
    appointment = session.get(Appointment, payload.appointment_id)
    if not appointment:
        raise HTTPException(404, "Appointment not found")
    item = Consultation(**payload.model_dump())
    appointment.status = "COMPLETED"
    session.add(item)
    session.commit()
    session.refresh(item)
    return consultation_out(item)
