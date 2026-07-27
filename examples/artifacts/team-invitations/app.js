const form = document.querySelector("#invite-form");
const feedback = document.querySelector("#feedback");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const email = String(data.get("email") || "");
  const role = String(data.get("role") || "Editor");
  feedback.textContent = `Invitation ready for ${email} with the ${role} role.`;
  form.reset();
});
