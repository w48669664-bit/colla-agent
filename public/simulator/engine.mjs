export const SERVICES = Object.freeze([
  { id: "identity", name: "Identity edge", owner: "Platform", dependencies: [], x: 70, y: 230 },
  { id: "catalog", name: "Catalog API", owner: "Commerce", dependencies: ["identity"], x: 320, y: 90 },
  { id: "payments", name: "Payments", owner: "Money movement", dependencies: ["identity"], x: 320, y: 370 },
  { id: "fulfillment", name: "Fulfillment", owner: "Operations", dependencies: ["catalog", "payments"], x: 570, y: 160 },
  { id: "analytics", name: "Decision data", owner: "Data", dependencies: ["catalog", "payments"], x: 570, y: 410 },
  { id: "notifications", name: "Notifications", owner: "Lifecycle", dependencies: ["fulfillment"], x: 790, y: 70 },
  { id: "release", name: "Release gate", owner: "Launch council", dependencies: ["fulfillment", "analytics", "notifications"], x: 790, y: 300 },
]);

export const SCENARIOS = Object.freeze({
  reset: {
    label: "Healthy baseline",
    description: "Clear all injected risk and return every service to its declared state.",
    changes: {},
  },
  auth_outage: {
    label: "Identity outage",
    description: "A failed identity edge blocks every authenticated downstream path.",
    changes: { identity: "failed" },
  },
  payment_latency: {
    label: "Payment latency",
    description: "Degraded payment performance raises downstream release risk without a hard block.",
    changes: { payments: "degraded" },
  },
  dual_incident: {
    label: "Dual incident",
    description: "Catalog failure and notification degradation test simultaneous propagation.",
    changes: { catalog: "failed", notifications: "degraded" },
  },
});

export function createBaseline(services = SERVICES) {
  return Object.fromEntries(services.map((service) => [service.id, "ready"]));
}

export function applyScenario(current, scenarioId, services = SERVICES) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const baseline = createBaseline(services);
  return scenarioId === "reset"
    ? baseline
    : { ...baseline, ...scenario.changes, ...onlyKnownStates(current, services, scenario.changes) };
}

export function evaluateRisk(baseState, services = SERVICES) {
  assertValidGraph(services);
  const declared = { ...createBaseline(services), ...baseState };
  const effective = {};
  const visiting = new Set();

  const visit = (id) => {
    if (effective[id]) return effective[id];
    if (visiting.has(id)) throw new Error(`Cyclic dependency detected at ${id}.`);
    const service = services.find((item) => item.id === id);
    if (!service) throw new Error(`Unknown service: ${id}`);
    visiting.add(id);
    const dependencyStates = service.dependencies.map(visit);
    visiting.delete(id);

    const own = declared[id];
    if (own === "failed") effective[id] = "failed";
    else if (dependencyStates.some((state) => state === "failed" || state === "blocked")) {
      effective[id] = "blocked";
    } else if (own === "degraded" || dependencyStates.some((state) => state === "degraded" || state === "at-risk")) {
      effective[id] = own === "ready" ? "at-risk" : "degraded";
    } else {
      effective[id] = "ready";
    }
    return effective[id];
  };

  for (const service of services) visit(service.id);
  return effective;
}

export function readinessScore(effectiveState) {
  const weights = { ready: 1, "at-risk": 0.62, degraded: 0.42, blocked: 0.1, failed: 0 };
  const values = Object.values(effectiveState);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, status) => sum + (weights[status] ?? 0), 0) / values.length * 100);
}

export function downstreamOf(serviceId, services = SERVICES) {
  const result = new Set();
  const visit = (id) => {
    for (const service of services) {
      if (!service.dependencies.includes(id) || result.has(service.id)) continue;
      result.add(service.id);
      visit(service.id);
    }
  };
  visit(serviceId);
  return [...result];
}

export function assertValidGraph(services = SERVICES) {
  const ids = new Set(services.map((service) => service.id));
  if (ids.size !== services.length) throw new Error("Service identifiers must be unique.");
  for (const service of services) {
    for (const dependency of service.dependencies) {
      if (!ids.has(dependency)) throw new Error(`${service.id} depends on unknown service ${dependency}.`);
    }
  }
  const baseline = createBaseline(services);
  const complete = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cyclic dependency detected at ${id}.`);
    visiting.add(id);
    const service = services.find((item) => item.id === id);
    for (const dependency of service.dependencies) visit(dependency);
    visiting.delete(id);
    complete.add(id);
  };
  for (const id of Object.keys(baseline)) visit(id);
  return true;
}

function onlyKnownStates(current, services, scenarioChanges) {
  const known = new Set(services.map((service) => service.id));
  return Object.fromEntries(
    Object.entries(current || {}).filter(
      ([id, status]) =>
        known.has(id) &&
        !Object.hasOwn(scenarioChanges, id) &&
        ["ready", "degraded", "failed"].includes(status),
    ),
  );
}
