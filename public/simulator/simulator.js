import {
  SERVICES,
  SCENARIOS,
  applyScenario,
  createBaseline,
  downstreamOf,
  evaluateRisk,
  readinessScore,
} from "./engine.mjs";

const STORAGE_KEY = "colla-agent.release-readiness.v1";
const STATUS_COPY = {
  ready: "The service and every required dependency are healthy.",
  "at-risk": "A degraded dependency is raising launch risk for this service.",
  degraded: "The service is operating below its declared release threshold.",
  blocked: "A failed upstream dependency prevents this service from reaching the release gate.",
  failed: "The service has a direct incident and cannot satisfy its release contract.",
};

let state = loadState();
let effective = evaluateRisk(state.declared);

const elements = {
  score: document.querySelector("#score"),
  launchState: document.querySelector("#launch-state"),
  incidentCount: document.querySelector("#incident-count"),
  propagatedCount: document.querySelector("#propagated-count"),
  graph: document.querySelector("#graph"),
  scenarioList: document.querySelector("#scenario-list"),
  activeScenario: document.querySelector("#active-scenario"),
  search: document.querySelector("#service-search"),
  statusFilter: document.querySelector("#status-filter"),
  inspectorTitle: document.querySelector("#inspector-title"),
  inspectorStatus: document.querySelector("#inspector-status"),
  inspectorCopy: document.querySelector("#inspector-copy"),
  inspectorOwner: document.querySelector("#inspector-owner"),
  inspectorDependencies: document.querySelector("#inspector-dependencies"),
  inspectorDownstream: document.querySelector("#inspector-downstream"),
  manualStatus: document.querySelector("#manual-status"),
  mobileList: document.querySelector("#mobile-service-list"),
  resetButton: document.querySelector("#reset-button"),
  eventList: document.querySelector("#event-list"),
  announcer: document.querySelector("#announcer"),
};

renderScenarioDeck();
render();

elements.search.addEventListener("input", renderGraph);
elements.statusFilter.addEventListener("change", renderGraph);
elements.manualStatus.addEventListener("change", () => {
  state.declared[state.selected] = elements.manualStatus.value;
  state.scenario = "custom";
  addEvent(`${serviceById(state.selected).name} declared ${elements.manualStatus.value}.`);
  commitAndRender(`${serviceById(state.selected).name} is now ${elements.manualStatus.value}.`);
});
elements.resetButton.addEventListener("click", () => activateScenario("reset"));

function renderScenarioDeck() {
  elements.scenarioList.innerHTML = Object.entries(SCENARIOS).map(([id, scenario], index) => `
    <button class="scenario-button" type="button" data-scenario="${id}">
      <strong>${escapeHtml(scenario.label)}</strong>
      <span>${String(index + 1).padStart(2, "0")}</span>
      <small>${escapeHtml(scenario.description)}</small>
    </button>
  `).join("");
  elements.scenarioList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scenario]");
    if (button) activateScenario(button.dataset.scenario);
  });
}

function activateScenario(scenarioId) {
  state.declared = applyScenario({}, scenarioId);
  state.scenario = scenarioId;
  addEvent(SCENARIOS[scenarioId].description);
  commitAndRender(`${SCENARIOS[scenarioId].label} applied.`);
}

function selectService(serviceId) {
  state.selected = serviceId;
  persist();
  render();
}

function commitAndRender(announcement) {
  effective = evaluateRisk(state.declared);
  persist();
  render();
  elements.announcer.textContent = announcement;
}

function render() {
  effective = evaluateRisk(state.declared);
  const score = readinessScore(effective);
  const directIncidents = Object.values(state.declared).filter((status) => status !== "ready").length;
  const propagated = Object.entries(effective).filter(
    ([id, status]) => state.declared[id] === "ready" && status !== "ready",
  ).length;

  elements.score.textContent = String(score);
  elements.incidentCount.textContent = String(directIncidents);
  elements.propagatedCount.textContent = String(propagated);
  const launchLabel = score >= 90 ? "CLEAR TO SHIP" : score >= 60 ? "REVIEW REQUIRED" : "HOLD RELEASE";
  elements.launchState.textContent = launchLabel;
  elements.launchState.className = `state-pill ${score >= 90 ? "" : score >= 60 ? "is-risk" : "is-stop"}`.trim();
  elements.activeScenario.textContent = SCENARIOS[state.scenario]?.label || "Custom conditions";

  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scenario === state.scenario);
    button.setAttribute("aria-pressed", String(button.dataset.scenario === state.scenario));
  });

  renderGraph();
  renderInspector();
  renderEvents();
}

function renderGraph() {
  const query = elements.search.value.trim().toLowerCase();
  const statusFilter = elements.statusFilter.value;
  const visible = (service) =>
    (!query || `${service.name} ${service.owner}`.toLowerCase().includes(query)) &&
    (statusFilter === "all" || effective[service.id] === statusFilter);

  const edges = SERVICES.flatMap((service) =>
    service.dependencies.map((dependencyId) => {
      const source = serviceById(dependencyId);
      const status = effective[service.id];
      const className =
        ["failed", "blocked"].includes(status) ? "is-blocked" :
        ["degraded", "at-risk"].includes(status) ? "is-risk" :
        "";
      return `<path class="edge ${className}" d="M ${source.x + 150} ${source.y + 42} C ${source.x + 190} ${source.y + 42}, ${service.x - 40} ${service.y + 42}, ${service.x} ${service.y + 42}" />`;
    }),
  ).join("");

  const nodes = SERVICES.map((service) => {
    const status = effective[service.id];
    const filtered = visible(service) ? "" : "is-filtered";
    const selected = service.id === state.selected ? "is-selected" : "";
    return `
      <g
        class="service-node ${filtered} ${selected}"
        data-service="${service.id}"
        data-status="${status}"
        role="button"
        tabindex="${visible(service) ? "0" : "-1"}"
        aria-label="${escapeHtml(service.name)}, ${status}"
        transform="translate(${service.x} ${service.y})"
      >
        <rect width="160" height="84" rx="8" />
        <circle class="status-dot" cx="18" cy="19" r="5" />
        <text class="service-status" x="31" y="22">${status.toUpperCase()}</text>
        <text class="service-title" x="16" y="48">${escapeHtml(service.name)}</text>
        <text class="service-owner" x="16" y="68">${escapeHtml(service.owner)}</text>
      </g>
    `;
  }).join("");

  elements.graph.innerHTML = `
    <title id="graph-title">Service dependency and risk propagation graph</title>
    <desc id="graph-description">Seven connected release services. Select a service to inspect its dependencies and downstream impact.</desc>
    ${edges}${nodes}
  `;
  elements.graph.querySelectorAll("[data-service]").forEach((node) => {
    node.addEventListener("click", () => selectService(node.dataset.service));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectService(node.dataset.service);
      }
    });
  });

  elements.mobileList.innerHTML = SERVICES.map((service) => `
    <button
      class="mobile-service ${visible(service) ? "" : "is-filtered"}"
      type="button"
      data-mobile-service="${service.id}"
      data-status="${effective[service.id]}"
    >
      <strong>${escapeHtml(service.name)}</strong>
      <span>${effective[service.id]}</span>
    </button>
  `).join("");
  elements.mobileList.querySelectorAll("[data-mobile-service]").forEach((button) => {
    button.addEventListener("click", () => selectService(button.dataset.mobileService));
  });
}

function renderInspector() {
  const service = serviceById(state.selected);
  const status = effective[service.id];
  elements.inspectorTitle.textContent = service.name;
  elements.inspectorStatus.textContent = status.toUpperCase();
  elements.inspectorStatus.dataset.status = status;
  elements.inspectorCopy.textContent = STATUS_COPY[status];
  elements.inspectorOwner.textContent = service.owner;
  elements.inspectorDependencies.textContent = `${service.dependencies.length} ${service.dependencies.length === 1 ? "service" : "services"}`;
  const downstream = downstreamOf(service.id);
  elements.inspectorDownstream.textContent = `${downstream.length} ${downstream.length === 1 ? "service" : "services"}`;
  elements.manualStatus.value = state.declared[service.id];
}

function renderEvents() {
  elements.eventList.innerHTML = state.events.slice(0, 6).map((event) => `
    <li><time datetime="${event.at}">${formatTime(event.at)}</time><span>${escapeHtml(event.message)}</span></li>
  `).join("");
}

function addEvent(message) {
  state.events.unshift({ at: new Date().toISOString(), message });
  state.events = state.events.slice(0, 20);
}

function loadState() {
  const fallback = {
    declared: createBaseline(),
    selected: "release",
    scenario: "reset",
    events: [{ at: new Date().toISOString(), message: "Healthy baseline loaded." }],
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored?.declared || !SERVICES.some((service) => service.id === stored.selected)) return fallback;
    return { ...fallback, ...stored, declared: { ...createBaseline(), ...stored.declared } };
  } catch {
    return fallback;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The simulator remains fully usable when storage is unavailable.
  }
}

function serviceById(id) {
  const service = SERVICES.find((item) => item.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

window.__simulatorDebug = Object.freeze({
  getState: () => ({
    declared: { ...state.declared },
    effective: { ...effective },
    scenario: state.scenario,
    selected: state.selected,
    score: readinessScore(effective),
  }),
  scenario: (scenarioId) => {
    activateScenario(scenarioId);
    return window.__simulatorDebug.getState();
  },
  setService: (serviceId, status) => {
    if (!SERVICES.some((service) => service.id === serviceId)) throw new Error(`Unknown service: ${serviceId}`);
    if (!["ready", "degraded", "failed"].includes(status)) throw new Error(`Invalid status: ${status}`);
    state.declared[serviceId] = status;
    state.scenario = "custom";
    commitAndRender(`${serviceById(serviceId).name} set to ${status}.`);
    return window.__simulatorDebug.getState();
  },
  reset: () => {
    activateScenario("reset");
    return window.__simulatorDebug.getState();
  },
  services: SERVICES.map((service) => ({ ...service, dependencies: [...service.dependencies] })),
});
