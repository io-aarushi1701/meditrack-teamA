/* Milestone 3 UI increment: bind a consultation form and history table. */
async function loadConsultations() {
  const rows = await api("/consultations");
  document.querySelector("#consultationRows").innerHTML = rows.map(row => `
    <tr><td>${row.patient_name}</td><td>${row.doctor_name}</td>
    <td>${row.diagnosis || "—"}</td><td>${row.prescription || "—"}</td></tr>`).join("");
}

document.querySelector("#consultationForm").onsubmit = async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target));
  payload.appointment_id = Number(payload.appointment_id);
  await post("/consultations", payload);
  event.target.reset();
  await loadConsultations();
};
