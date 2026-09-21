"""Populate a few doctors and patients so the UI isn't empty. Safe to re-run."""
from datetime import date

from database import Base, SessionLocal, create_database_if_missing, engine
import models

DOCTORS = [
    ("Dr. Anita Rao", "Cardiology", "anita.rao@meditrack.test"),
    ("Dr. Vikram Shah", "General Medicine", "vikram.shah@meditrack.test"),
    ("Dr. Leena Fernandes", "Dermatology", "leena.f@meditrack.test"),
    ("Dr. Karan Mehta", "Orthopedics", "karan.mehta@meditrack.test"),
]

PATIENTS = [
    ("John Doe", "johndoe@example.com", "123-456-7230", date(1998, 5, 7), "Male", "O+", "Penicillin"),
    ("Priya Nair", "priya.nair@example.com", "987-654-3210", date(1991, 11, 2), "Female", "A+", "None"),
    ("Sam Okafor", "sam.okafor@example.com", "555-201-8890", date(1985, 3, 19), "Male", "B-", "Dust, pollen"),
]


def run():
    create_database_if_missing()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    for name, specialty, email in DOCTORS:
        if not db.query(models.Doctor).filter_by(email=email).first():
            db.add(models.Doctor(name=name, specialty=specialty, email=email))

    for name, email, phone, dob, gender, blood, allergies in PATIENTS:
        if not db.query(models.Patient).filter_by(email=email).first():
            db.add(models.Patient(
                name=name, email=email, phone=phone, date_of_birth=dob,
                gender=gender, blood_type=blood, allergies=allergies,
            ))

    db.commit()
    print("Seeded: {} doctors, {} patients".format(
        db.query(models.Doctor).count(), db.query(models.Patient).count()))
    db.close()


if __name__ == "__main__":
    run()
