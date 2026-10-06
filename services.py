"""Audit logging, notifications and the reminder sweep."""
import logging
import os
import smtplib
import threading
from datetime import datetime, timedelta
from email.message import EmailMessage

import models

log = logging.getLogger("meditrack")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER or "no-reply@meditrack.local")


def fmt_slot(moment):
    return moment.strftime("%a %d %b %Y, %H:%M")


# ------------------------------------------------------------------ audit
def audit(db, user, action, entity=None, entity_id=None, details=None, request=None):
    """Add an audit row to the session; the caller's commit persists it."""
    db.add(models.AuditLog(
        user_email=user.email if user is not None and hasattr(user, "email") else user,
        action=action,
        entity=entity,
        entity_id=entity_id,
        details=(details or "")[:500] or None,
        ip=request.client.host if request is not None and request.client else None,
    ))


# ---------------------------------------------------------- notifications
def _send_email(to, subject, body):
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
    except Exception as exc:  # email is best-effort; the in-app notification still exists
        log.warning("Email to %s failed: %s", to, exc)


def _notify_users(db, users, kind, message):
    for user in users:
        db.add(models.Notification(user_id=user.id, kind=kind, message=message))
        if SMTP_HOST:
            threading.Thread(
                target=_send_email, args=(user.email, "MediTrack: " + kind.title().replace("_", " "), message),
                daemon=True,
            ).start()


def notify_patient(db, patient_id, kind, message):
    _notify_users(db, db.query(models.User).filter_by(patient_id=patient_id).all(), kind, message)


def notify_doctor(db, doctor_id, kind, message):
    _notify_users(db, db.query(models.User).filter_by(doctor_id=doctor_id).all(), kind, message)


# ---------------------------------------------------------- reminder sweep
REMIND_WITHIN = timedelta(hours=24)
MISSED_AFTER = timedelta(hours=1)


def sweep_appointments(db):
    """Send 24h reminders and flag booked appointments that were never attended."""
    now = datetime.now()

    upcoming = db.query(models.Appointment).filter(
        models.Appointment.status == "BOOKED",
        models.Appointment.slot > now,
        models.Appointment.slot <= now + REMIND_WITHIN,
    ).all()
    for appt in upcoming:
        if appt.reminder_sent:
            continue
        when = fmt_slot(appt.slot)
        notify_patient(db, appt.patient_id, "REMINDER",
                       "Reminder: appointment with {} on {}".format(appt.doctor.name, when))
        notify_doctor(db, appt.doctor_id, "REMINDER",
                      "Upcoming: {} on {}".format(appt.patient.name, when))
        appt.reminder_sent = True

    missed = db.query(models.Appointment).filter(
        models.Appointment.status == "BOOKED",
        models.Appointment.slot < now - MISSED_AFTER,
    ).all()
    for appt in missed:
        appt.status = "NO_SHOW"
        when = fmt_slot(appt.slot)
        notify_patient(db, appt.patient_id, "MISSED",
                       "You missed your appointment with {} on {}. Please book again.".format(appt.doctor.name, when))
        notify_doctor(db, appt.doctor_id, "MISSED",
                      "{} did not attend the appointment on {}".format(appt.patient.name, when))
        audit(db, "system", "APPOINTMENT_NO_SHOW", "appointment", appt.id, when)

    if upcoming or missed:
        db.commit()
