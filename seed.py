"""Populate demo users, doctors, patients and appointment history. Safe to re-run."""
import random
from datetime import date, datetime, timedelta

from auth import hash_password
from database import SessionLocal, init_db
import models

ADMIN = ("admin@meditrack.test", "admin123")
DOCTOR_PASSWORD = "doctor123"
PATIENT_PASSWORD = "patient123"

DOCTORS = [
    ("Dr. Anita Rao", "Cardiology", "anita.rao@meditrack.test"),
    ("Dr. Vikram Shah", "General Medicine", "vikram.shah@meditrack.test"),
    ("Dr. Leena Fernandes", "Dermatology", "leena.f@meditrack.test"),
    ("Dr. Karan Mehta", "Orthopedics", "karan.mehta@meditrack.test"),
]

PATIENTS = [
    # name, email, phone, dob, gender, blood, allergies, chronic, insurance, emergency contact
    ("John Doe", "johndoe@example.com", "123-456-7230", date(1998, 5, 7), "Male", "O+", "Penicillin",
     "", "Star Health", ("Jane Doe", "123-456-7231")),
    ("Priya Nair", "priya.nair@example.com", "987-654-3210", date(1991, 11, 2), "Female", "A+", "None",
     "Asthma", "HDFC Ergo", ("Arun Nair", "987-654-3211")),
    ("Sam Okafor", "sam.okafor@example.com", "555-201-8890", date(1985, 3, 19), "Male", "B-", "Dust, pollen",
     "Hypertension", "", ("", "")),
    ("Meera Iyer", "meera.iyer@example.com", "555-310-4471", date(1962, 8, 30), "Female", "AB+", "Sulfa drugs",
     "Type 2 diabetes", "ICICI Lombard", ("Ravi Iyer", "555-310-4472")),
    ("Daniel Brooks", "daniel.brooks@example.com", "555-118-2093", date(2009, 1, 14), "Male", "O-", "None",
     "", "Star Health", ("Laura Brooks", "555-118-2094")),
    ("Fatima Sheikh", "fatima.sheikh@example.com", "555-772-6610", date(1978, 6, 21), "Female", "A-", "Latex",
     "Hypothyroidism", "Niva Bupa", ("Imran Sheikh", "555-772-6611")),
    ("Arjun Kapoor", "arjun.kapoor@example.com", "555-904-3382", date(1955, 12, 5), "Male", "B+", "Aspirin",
     "Coronary artery disease", "", ("Kavya Kapoor", "555-904-3383")),
    ("Grace Lee", "grace.lee@example.com", "555-650-1928", date(2001, 4, 9), "Female", "O+", "None",
     "", "HDFC Ergo", ("", "")),
]

CASES = {
    "Cardiology": [
        ("Chest discomfort on exertion", "Stable angina", [("Aspirin", "75mg", "Once daily", "30 days"),
                                                          ("Atorvastatin", "20mg", "At night", "30 days")]),
        ("Elevated BP at home", "Mild hypertension", [("Lisinopril", "10mg", "Once daily", "30 days")]),
    ],
    "General Medicine": [
        ("Fever, sore throat", "Viral pharyngitis", [("Paracetamol", "500mg", "Every 6 hours", "5 days")]),
        ("Fatigue, frequent urination", "Type 2 diabetes review", [("Metformin", "500mg", "Twice daily", "90 days")]),
        ("Cough for 1 week", "Acute bronchitis", [("Amoxicillin", "500mg", "Three times daily", "7 days")]),
    ],
    "Dermatology": [
        ("Itchy rash on forearms", "Contact dermatitis", [("Hydrocortisone cream 1%", "Thin layer", "Twice daily", "10 days")]),
        ("Acne flare-up", "Acne vulgaris", [("Adapalene gel", "Pea-sized", "At night", "8 weeks")]),
    ],
    "Orthopedics": [
        ("Knee pain after running", "Patellofemoral pain syndrome", [("Ibuprofen", "400mg", "Twice daily after food", "7 days")]),
        ("Lower back pain", "Lumbar strain", [("Diclofenac gel", "Apply locally", "Three times daily", "10 days")]),
    ],
}


def _user(db, email, password, role, **link):
    user = db.query(models.User).filter_by(email=email).first()
    if not user:
        db.add(models.User(email=email, password_hash=hash_password(password), role=role, **link))


def _history(db, rng):
    """About six months of appointments, plus a few upcoming ones."""
    doctors = db.query(models.Doctor).all()
    patients = db.query(models.Patient).all()
    taken = set()
    today = datetime.now().replace(minute=0, second=0, microsecond=0)

    def free_slot(day_offset, doctor, patient):
        day = today + timedelta(days=day_offset)
        if day.weekday() >= 5:
            return None
        for _ in range(8):
            moment = day.replace(hour=rng.randint(9, 16))
            if ("d", doctor.id, moment) not in taken and ("p", patient.id, moment) not in taken:
                taken.add(("d", doctor.id, moment))
                taken.add(("p", patient.id, moment))
                return moment
        return None

    for offset in range(-180, 15):
        for _ in range(rng.choice([0, 1, 1, 2])):
            doctor, patient = rng.choice(doctors), rng.choice(patients)
            slot = free_slot(offset, doctor, patient)
            if not slot:
                continue
            symptoms, diagnosis, meds = rng.choice(CASES.get(doctor.specialty, CASES["General Medicine"]))
            if slot > datetime.now():
                status = rng.choices(["BOOKED", "CANCELLED"], [9, 1])[0]
            else:
                status = rng.choices(["COMPLETED", "CANCELLED", "NO_SHOW"], [8, 1, 1])[0]
            appt = models.Appointment(patient_id=patient.id, doctor_id=doctor.id, slot=slot,
                                      reason=symptoms, status=status, reminder_sent=slot < datetime.now())
            db.add(appt)
            if status == "COMPLETED":
                db.flush()
                db.add(models.Consultation(
                    appointment_id=appt.id, symptoms=symptoms, diagnosis=diagnosis,
                    notes="Vitals stable. Advised to return if symptoms persist.",
                    prescription="Plenty of fluids and rest.", created_at=slot + timedelta(minutes=40),
                    items=[models.PrescriptionItem(medication=m, dosage=d, frequency=f, duration=t)
                           for m, d, f, t in meds],
                ))


def run():
    init_db()
    db = SessionLocal()
    rng = random.Random(42)

    _user(db, ADMIN[0], ADMIN[1], "ADMIN")

    for name, specialty, email in DOCTORS:
        doctor = db.query(models.Doctor).filter_by(email=email).first()
        if not doctor:
            doctor = models.Doctor(name=name, specialty=specialty, email=email)
            db.add(doctor)
            db.flush()
        _user(db, email, DOCTOR_PASSWORD, "DOCTOR", doctor_id=doctor.id)

    for name, email, phone, dob, gender, blood, allergies, chronic, insurance, (ec_name, ec_phone) in PATIENTS:
        patient = db.query(models.Patient).filter_by(email=email).first()
        if not patient:
            patient = models.Patient(
                name=name, email=email, phone=phone, date_of_birth=dob, gender=gender, blood_type=blood,
                allergies=allergies, chronic_conditions=chronic or None, insurance_provider=insurance or None,
                insurance_number="POL-{}".format(rng.randint(100000, 999999)) if insurance else None,
                emergency_contact_name=ec_name or None, emergency_contact_phone=ec_phone or None,
                created_at=datetime.now() - timedelta(days=rng.randint(0, 200)),
            )
            db.add(patient)
            db.flush()
        _user(db, email, PATIENT_PASSWORD, "PATIENT", patient_id=patient.id)

    db.flush()
    if db.query(models.Appointment).count() == 0:
        _history(db, rng)

    db.commit()
    print("Seeded: {} doctors, {} patients, {} appointments, {} users".format(
        db.query(models.Doctor).count(), db.query(models.Patient).count(),
        db.query(models.Appointment).count(), db.query(models.User).count()))
    print("Logins — admin: {} / {} | doctors: <doctor email> / {} | patients: <patient email> / {}".format(
        ADMIN[0], ADMIN[1], DOCTOR_PASSWORD, PATIENT_PASSWORD))
    db.close()


if __name__ == "__main__":
    run()
