/**
 * routes/manufacturing.js
 * ─────────────────────────────────────────────────────────────────
 * All Manufacturing module API endpoints.
 * Business logic now lives in services/manufacturingService.js —
 * this file is just HTTP plumbing (auth, params, error responses).
 *
 * Mount in server.js with:
 *   const manufacturingRoutes = require("./routes/manufacturing");
 *   app.use("/api/manufacturing", manufacturingRoutes);
 * ─────────────────────────────────────────────────────────────────
 */

const express           = require("express");
const router            = express.Router();
const authenticateToken = require("../middleware/auth");
const svc               = require("../services/manufacturingService");

// ─── Generic error handler ────────────────────────────────────────
const send = (res, promise) =>
  promise
    .then(r  => res.json(r))
    .catch(e => { console.error(e); res.status(400).json({ message: e.message }); });

// ══════════════════════════════════════════════════════════════════
// PRODUCTION PLANS
// ══════════════════════════════════════════════════════════════════
router.get("/plans",        authenticateToken, (req, res) => send(res, svc.fetchPlans(req.industryId)));
router.post("/plans",       authenticateToken, (req, res) => send(res, svc.createPlan(req.industryId, req.body)));
router.put("/plans/:id",    authenticateToken, (req, res) => send(res, svc.updatePlan(req.industryId, req.params.id, req.body)));
router.delete("/plans/:id", authenticateToken, (req, res) => send(res, svc.deletePlan(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// BILL OF MATERIALS
// ══════════════════════════════════════════════════════════════════
router.get("/bom",        authenticateToken, (req, res) => send(res, svc.fetchBOMs(req.industryId)));
router.post("/bom",       authenticateToken, (req, res) => send(res, svc.createBOM(req.industryId, req.body)));
router.put("/bom/:id",    authenticateToken, (req, res) => send(res, svc.updateBOM(req.industryId, req.params.id, req.body)));
router.delete("/bom/:id", authenticateToken, (req, res) => send(res, svc.deleteBOM(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// WORK ORDERS
// ══════════════════════════════════════════════════════════════════
router.get("/work-orders",        authenticateToken, (req, res) => send(res, svc.fetchWorkOrders(req.industryId)));
router.post("/work-orders",       authenticateToken, (req, res) => send(res, svc.createWorkOrder(req.industryId, req.body)));
router.put("/work-orders/:id",    authenticateToken, (req, res) => send(res, svc.updateWorkOrder(req.industryId, req.params.id, req.body)));
router.delete("/work-orders/:id", authenticateToken, (req, res) => send(res, svc.deleteWorkOrder(req.industryId, req.params.id)));

// Start/finish a production run tied to a Work Order — flips machine/resource
// status Idle → Running on start, Running → Idle on finish (your required flow)
router.post("/work-orders/:id/start",  authenticateToken, (req, res) => send(res, svc.startProductionRun(req.industryId, req.params.id)));
router.post("/work-orders/:id/finish", authenticateToken, (req, res) => send(res, svc.finishProductionRun(req.industryId, req.params.id, req.body)));

// Purchases module integration: check this WO's BOM against real stock and
// auto-raise Purchase Order(s) (via purchaseService.createPurchase) for any
// shortfall, grouped by each component's default supplier.
router.post("/work-orders/:id/create-po", authenticateToken, (req, res) => {
  const userId = req.user?.id || req.user?.userId || null;
  send(res, svc.createPurchaseOrderFromShortfall(req.industryId, req.params.id, userId));
});

// ══════════════════════════════════════════════════════════════════
// PRODUCTION RUNS — saving/editing/deleting these moves stock
// ══════════════════════════════════════════════════════════════════
router.get("/production",        authenticateToken, (req, res) => send(res, svc.fetchProduction(req.industryId)));
router.post("/production",       authenticateToken, (req, res) => send(res, svc.createProduction(req.industryId, req.body)));
router.put("/production/:id",    authenticateToken, (req, res) => send(res, svc.updateProduction(req.industryId, req.params.id, req.body)));
router.delete("/production/:id", authenticateToken, (req, res) => send(res, svc.deleteProduction(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// RESOURCES
// ══════════════════════════════════════════════════════════════════
router.get("/resources",        authenticateToken, (req, res) => send(res, svc.fetchResources(req.industryId)));
router.post("/resources",       authenticateToken, (req, res) => send(res, svc.createResource(req.industryId, req.body)));
router.put("/resources/:id",    authenticateToken, (req, res) => send(res, svc.updateResource(req.industryId, req.params.id, req.body)));
router.delete("/resources/:id", authenticateToken, (req, res) => send(res, svc.deleteResource(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// MACHINES
// ══════════════════════════════════════════════════════════════════
router.get("/machines",        authenticateToken, (req, res) => send(res, svc.fetchMachines(req.industryId)));
router.post("/machines",       authenticateToken, (req, res) => send(res, svc.createMachine(req.industryId, req.body)));
router.put("/machines/:id",    authenticateToken, (req, res) => send(res, svc.updateMachine(req.industryId, req.params.id, req.body)));
router.delete("/machines/:id", authenticateToken, (req, res) => send(res, svc.deleteMachine(req.industryId, req.params.id)));

// Fleet-wide OEE (must be registered BEFORE /machines/:id/detail-style routes
// only matters if paths collide — these don't, but keep fleet route grouped here)
router.get("/machines/oee", authenticateToken, (req, res) =>
  send(res, svc.fetchFleetOEE(req.industryId, req.query.from, req.query.to)));

// Full machine profile (specs + logs + documents + maintenance + related QC)
router.get("/machines/:id/detail", authenticateToken, (req, res) =>
  send(res, svc.fetchMachineDetail(req.industryId, req.params.id)));

// Per-machine OEE for a date range
router.get("/machines/:id/oee", authenticateToken, (req, res) =>
  send(res, svc.fetchMachineOEE(req.industryId, req.params.id, req.query.from, req.query.to)));

// Machine logs (running/idle/downtime/maintenance events)
router.get("/machines/:id/logs",     authenticateToken, (req, res) => send(res, svc.fetchMachineLogs(req.industryId, req.params.id)));
router.post("/machines/:id/logs",    authenticateToken, (req, res) => send(res, svc.createMachineLog(req.industryId, req.params.id, req.body)));
router.put("/machines/logs/:id",     authenticateToken, (req, res) => send(res, svc.updateMachineLog(req.industryId, req.params.id, req.body)));
router.delete("/machines/logs/:id",  authenticateToken, (req, res) => send(res, svc.deleteMachineLog(req.industryId, req.params.id)));

// Machine documents
router.get("/machines/:id/documents",    authenticateToken, (req, res) => send(res, svc.fetchMachineDocuments(req.industryId, req.params.id)));
router.post("/machines/:id/documents",   authenticateToken, (req, res) => send(res, svc.createMachineDocument(req.industryId, req.params.id, req.body)));
router.delete("/machines/documents/:id", authenticateToken, (req, res) => send(res, svc.deleteMachineDocument(req.industryId, req.params.id)));


// ══════════════════════════════════════════════════════════════════
// QUALITY CHECKS
// ══════════════════════════════════════════════════════════════════
router.get("/quality-checks",        authenticateToken, (req, res) => send(res, svc.fetchQualityChecks(req.industryId)));
router.post("/quality-checks",       authenticateToken, (req, res) => send(res, svc.createQualityCheck(req.industryId, req.body)));
router.put("/quality-checks/:id",    authenticateToken, (req, res) => send(res, svc.updateQualityCheck(req.industryId, req.params.id, req.body)));
router.delete("/quality-checks/:id", authenticateToken, (req, res) => send(res, svc.deleteQualityCheck(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// MAINTENANCE
// ══════════════════════════════════════════════════════════════════
router.get("/maintenance",        authenticateToken, (req, res) => send(res, svc.fetchMaintenance(req.industryId)));
router.post("/maintenance",       authenticateToken, (req, res) => send(res, svc.createMaintenance(req.industryId, req.body)));
router.put("/maintenance/:id",    authenticateToken, (req, res) => send(res, svc.updateMaintenance(req.industryId, req.params.id, req.body)));
router.delete("/maintenance/:id", authenticateToken, (req, res) => send(res, svc.deleteMaintenance(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// SCHEDULE
// ══════════════════════════════════════════════════════════════════
router.get("/schedule",        authenticateToken, (req, res) => send(res, svc.fetchSchedule(req.industryId)));
router.post("/schedule",       authenticateToken, (req, res) => send(res, svc.createSchedule(req.industryId, req.body)));
router.put("/schedule/:id",    authenticateToken, (req, res) => send(res, svc.updateSchedule(req.industryId, req.params.id, req.body)));
router.delete("/schedule/:id", authenticateToken, (req, res) => send(res, svc.deleteSchedule(req.industryId, req.params.id)));

// ══════════════════════════════════════════════════════════════════
// REPORTS — Summary for Production Reports tab
// ══════════════════════════════════════════════════════════════════
router.get("/reports/summary", authenticateToken, (req, res) =>
  send(res, svc.fetchReportsSummary(req.industryId, req.query.from, req.query.to)));
router.get("/reports/cost-variance", authenticateToken, (req, res) =>
  send(res, svc.fetchCostVariance(req.industryId, req.query.from, req.query.to))
);

module.exports = router;