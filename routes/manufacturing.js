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
router.get("/plans",        authenticateToken, (req, res) => send(res, svc.fetchPlans()));
router.post("/plans",       authenticateToken, (req, res) => send(res, svc.createPlan(req.body)));
router.put("/plans/:id",    authenticateToken, (req, res) => send(res, svc.updatePlan(req.params.id, req.body)));
router.delete("/plans/:id", authenticateToken, (req, res) => send(res, svc.deletePlan(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// BILL OF MATERIALS
// ══════════════════════════════════════════════════════════════════
router.get("/bom",        authenticateToken, (req, res) => send(res, svc.fetchBOMs()));
router.post("/bom",       authenticateToken, (req, res) => send(res, svc.createBOM(req.body)));
router.put("/bom/:id",    authenticateToken, (req, res) => send(res, svc.updateBOM(req.params.id, req.body)));
router.delete("/bom/:id", authenticateToken, (req, res) => send(res, svc.deleteBOM(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// WORK ORDERS
// ══════════════════════════════════════════════════════════════════
router.get("/work-orders",        authenticateToken, (req, res) => send(res, svc.fetchWorkOrders()));
router.post("/work-orders",       authenticateToken, (req, res) => send(res, svc.createWorkOrder(req.body)));
router.put("/work-orders/:id",    authenticateToken, (req, res) => send(res, svc.updateWorkOrder(req.params.id, req.body)));
router.delete("/work-orders/:id", authenticateToken, (req, res) => send(res, svc.deleteWorkOrder(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// PRODUCTION RUNS — saving/editing/deleting these moves stock
// ══════════════════════════════════════════════════════════════════
router.get("/production",        authenticateToken, (req, res) => send(res, svc.fetchProduction()));
router.post("/production",       authenticateToken, (req, res) => send(res, svc.createProduction(req.body)));
router.put("/production/:id",    authenticateToken, (req, res) => send(res, svc.updateProduction(req.params.id, req.body)));
router.delete("/production/:id", authenticateToken, (req, res) => send(res, svc.deleteProduction(req.params.id)));

// Start/finish a production run tied to a Work Order — flips machine/resource
// status Idle → Running on start, Running → Idle on finish (your required flow)
router.post("/work-orders/:id/start",  authenticateToken, (req, res) => send(res, svc.startProductionRun(req.params.id)));
router.post("/work-orders/:id/finish", authenticateToken, (req, res) => send(res, svc.finishProductionRun(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// RESOURCES
// ══════════════════════════════════════════════════════════════════
router.get("/resources",        authenticateToken, (req, res) => send(res, svc.fetchResources()));
router.post("/resources",       authenticateToken, (req, res) => send(res, svc.createResource(req.body)));
router.put("/resources/:id",    authenticateToken, (req, res) => send(res, svc.updateResource(req.params.id, req.body)));
router.delete("/resources/:id", authenticateToken, (req, res) => send(res, svc.deleteResource(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// MACHINES
// ══════════════════════════════════════════════════════════════════
router.get("/machines",        authenticateToken, (req, res) => send(res, svc.fetchMachines()));
router.post("/machines",       authenticateToken, (req, res) => send(res, svc.createMachine(req.body)));
router.put("/machines/:id",    authenticateToken, (req, res) => send(res, svc.updateMachine(req.params.id, req.body)));
router.delete("/machines/:id", authenticateToken, (req, res) => send(res, svc.deleteMachine(req.params.id)));

// Fleet-wide OEE (must be registered BEFORE /machines/:id/detail-style routes
// only matters if paths collide — these don't, but keep fleet route grouped here)
router.get("/machines/oee", authenticateToken, (req, res) =>
  send(res, svc.fetchFleetOEE(req.query.from, req.query.to)));

// Full machine profile (specs + logs + documents + maintenance + related QC)
router.get("/machines/:id/detail", authenticateToken, (req, res) =>
  send(res, svc.fetchMachineDetail(req.params.id)));

// Per-machine OEE for a date range
router.get("/machines/:id/oee", authenticateToken, (req, res) =>
  send(res, svc.fetchMachineOEE(req.params.id, req.query.from, req.query.to)));

// Machine logs (running/idle/downtime/maintenance events)
router.get("/machines/:id/logs",     authenticateToken, (req, res) => send(res, svc.fetchMachineLogs(req.params.id)));
router.post("/machines/:id/logs",    authenticateToken, (req, res) => send(res, svc.createMachineLog(req.params.id, req.body)));
router.put("/machines/logs/:id",     authenticateToken, (req, res) => send(res, svc.updateMachineLog(req.params.id, req.body)));
router.delete("/machines/logs/:id",  authenticateToken, (req, res) => send(res, svc.deleteMachineLog(req.params.id)));

// Machine documents
router.get("/machines/:id/documents",    authenticateToken, (req, res) => send(res, svc.fetchMachineDocuments(req.params.id)));
router.post("/machines/:id/documents",   authenticateToken, (req, res) => send(res, svc.createMachineDocument(req.params.id, req.body)));
router.delete("/machines/documents/:id", authenticateToken, (req, res) => send(res, svc.deleteMachineDocument(req.params.id)));


// ══════════════════════════════════════════════════════════════════
// QUALITY CHECKS
// ══════════════════════════════════════════════════════════════════
router.get("/quality-checks",        authenticateToken, (req, res) => send(res, svc.fetchQualityChecks()));
router.post("/quality-checks",       authenticateToken, (req, res) => send(res, svc.createQualityCheck(req.body)));
router.put("/quality-checks/:id",    authenticateToken, (req, res) => send(res, svc.updateQualityCheck(req.params.id, req.body)));
router.delete("/quality-checks/:id", authenticateToken, (req, res) => send(res, svc.deleteQualityCheck(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// MAINTENANCE
// ══════════════════════════════════════════════════════════════════
router.get("/maintenance",        authenticateToken, (req, res) => send(res, svc.fetchMaintenance()));
router.post("/maintenance",       authenticateToken, (req, res) => send(res, svc.createMaintenance(req.body)));
router.put("/maintenance/:id",    authenticateToken, (req, res) => send(res, svc.updateMaintenance(req.params.id, req.body)));
router.delete("/maintenance/:id", authenticateToken, (req, res) => send(res, svc.deleteMaintenance(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// SCHEDULE
// ══════════════════════════════════════════════════════════════════
router.get("/schedule",        authenticateToken, (req, res) => send(res, svc.fetchSchedule()));
router.post("/schedule",       authenticateToken, (req, res) => send(res, svc.createSchedule(req.body)));
router.put("/schedule/:id",    authenticateToken, (req, res) => send(res, svc.updateSchedule(req.params.id, req.body)));
router.delete("/schedule/:id", authenticateToken, (req, res) => send(res, svc.deleteSchedule(req.params.id)));

// ══════════════════════════════════════════════════════════════════
// REPORTS — Summary for Production Reports tab
// ══════════════════════════════════════════════════════════════════
router.get("/reports/summary", authenticateToken, (req, res) =>
  send(res, svc.fetchReportsSummary(req.query.from, req.query.to)));

module.exports = router;