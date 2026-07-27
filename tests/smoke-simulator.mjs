import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SERVICES,
  applyScenario,
  assertValidGraph,
  createBaseline,
  downstreamOf,
  evaluateRisk,
  readinessScore,
} from "../public/simulator/engine.mjs";

assert.equal(SERVICES.length, 7);
assert.equal(assertValidGraph(), true);

const baseline = evaluateRisk(createBaseline());
assert.ok(Object.values(baseline).every((status) => status === "ready"));
assert.equal(readinessScore(baseline), 100);

const paymentLatency = evaluateRisk(applyScenario({}, "payment_latency"));
assert.equal(paymentLatency.payments, "degraded");
assert.equal(paymentLatency.fulfillment, "at-risk");
assert.equal(paymentLatency.analytics, "at-risk");
assert.equal(paymentLatency.release, "at-risk");

const authOutage = evaluateRisk(applyScenario({}, "auth_outage"));
assert.equal(authOutage.identity, "failed");
assert.equal(authOutage.catalog, "blocked");
assert.equal(authOutage.payments, "blocked");
assert.equal(authOutage.release, "blocked");

const dualIncident = evaluateRisk(applyScenario({}, "dual_incident"));
assert.equal(dualIncident.catalog, "failed");
assert.equal(dualIncident.notifications, "blocked");
assert.equal(dualIncident.release, "blocked");
assert.ok(readinessScore(dualIncident) < 60);

assert.deepEqual(
  downstreamOf("identity").sort(),
  ["analytics", "catalog", "fulfillment", "notifications", "payments", "release"],
);

assert.throws(
  () => assertValidGraph([
    { id: "a", dependencies: ["b"] },
    { id: "b", dependencies: ["a"] },
  ]),
  /Cyclic dependency/,
);

const [html, script, css] = await Promise.all([
  readFile(new URL("../public/simulator/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/simulator/simulator.js", import.meta.url), "utf8"),
  readFile(new URL("../public/simulator/styles.css", import.meta.url), "utf8"),
]);
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="img"/);
assert.match(html, /Find a service/);
assert.match(script, /window\.__simulatorDebug/);
assert.match(script, /localStorage/);
assert.match(css, /@media \(max-width: 780px\)/);
assert.match(css, /:focus-visible/);

console.log("PASS simulator graph and deterministic risk engine");
console.log("PASS scenarios, propagation, filters, persistence contract");
console.log("PASS accessibility and window.__simulatorDebug contract");
