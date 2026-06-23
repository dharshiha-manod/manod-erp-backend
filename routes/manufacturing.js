    /**
     * routes/manufacturing.js
     * ─────────────────────────────────────────────────────────────────
     * All Manufacturing module API endpoints.
     * Mount in server.js / app.js with:
     *   const manufacturingRoutes = require("./routes/manufacturing");
     *   app.use("/api/manufacturing", authenticateToken, manufacturingRoutes);
     * ─────────────────────────────────────────────────────────────────
     * Tables required in Supabase (PostgreSQL):
     *
     *  mfg_plans           – production planning
     *  mfg_bom             – bill of materials (header)
     *  mfg_bom_items       – bom ingredients / components
     *  mfg_work_orders     – work orders
     *  mfg_production      – production runs
     *  mfg_resources       – workshop resources
     *  mfg_machines        – machine registry
     *  mfg_quality_checks  – quality control inspections
     *  mfg_maintenance     – maintenance schedule
     * ─────────────────────────────────────────────────────────────────
     */

    const express = require("express");
    const router  = express.Router();
    const pool = require("../config/database");// your existing pg Pool

    // ─── Generic error handler ─────────────────────────────────────────
    const send = (res, promise) =>
    promise
        .then(r  => res.json(r))
        .catch(e => { console.error(e); res.status(500).json({ message: e.message }); });

    // ══════════════════════════════════════════════════════════════════
    // PRODUCTION PLANS
    // ══════════════════════════════════════════════════════════════════
    router.get("/plans", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_plans ORDER BY created_at DESC")
        .then(r => r.rows)));

    router.post("/plans", async (req, res) => {
    const { title, description, start_date, end_date, status, priority, assigned_team } = req.body;
    send(res, pool.query(
        `INSERT INTO mfg_plans (title, description, start_date, end_date, status, priority, assigned_team, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [title, description, start_date, end_date, status || "planned", priority || "medium", assigned_team]
    ).then(r => r.rows[0]));
    });

    router.put("/plans/:id", (req, res) => {
    const { title, description, start_date, end_date, status, priority, assigned_team } = req.body;
    send(res, pool.query(
        `UPDATE mfg_plans SET title=$1, description=$2, start_date=$3, end_date=$4,
        status=$5, priority=$6, assigned_team=$7, updated_at=NOW()
        WHERE id=$8 RETURNING *`,
        [title, description, start_date, end_date, status, priority, assigned_team, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/plans/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_plans WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // BILL OF MATERIALS
    // ══════════════════════════════════════════════════════════════════
    router.post("/bom", async (req, res) => {
  const { product_name, product_code, quantity, unit, version, status, notes, ingredients } = req.body;

  send(
    res,
    (async () => {
      const bom = await pool.query(
        `INSERT INTO mfg_bom (product_name, product_code, quantity, unit, version, status, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [product_name, product_code, quantity, unit || "pcs", version || "1.0", status || "active", notes]
      );

      const b = bom.rows[0];

      if (ingredients?.length) {
        for (const ing of ingredients) {
          if (!ing.item_name) continue;

          await pool.query(
            `INSERT INTO mfg_bom_items (bom_id, item_name, quantity, unit, cost)
             VALUES ($1,$2,$3,$4,$5)`,
            [b.id, ing.item_name, ing.quantity, ing.unit, ing.cost]
          );
        }
      }

      const updatedItems = await pool.query(
        "SELECT * FROM mfg_bom_items WHERE bom_id=$1",
        [b.id]
      );

      return {
        ...b,
        ingredients: updatedItems.rows,
      };
    })()
  );
});router.put("/bom/:id", async (req, res) => {
  const {
    product_name,
    product_code,
    quantity,
    unit,
    version,
    status,
    notes,
    ingredients,
  } = req.body;

  send(
    res,
    (async () => {
      const bom = await pool.query(
        `UPDATE mfg_bom
         SET product_name=$1,
             product_code=$2,
             quantity=$3,
             unit=$4,
             version=$5,
             status=$6,
             notes=$7,
             updated_at=NOW()
         WHERE id=$8
         RETURNING *`,
        [
          product_name,
          product_code,
          quantity,
          unit,
          version,
          status,
          notes,
          req.params.id,
        ]
      );

      const b = bom.rows[0];

      await pool.query(
        "DELETE FROM mfg_bom_items WHERE bom_id=$1",
        [b.id]
      );

      if (ingredients?.length) {
        for (const ing of ingredients) {
          if (!ing.item_name) continue;

          await pool.query(
            `INSERT INTO mfg_bom_items
             (bom_id, item_name, quantity, unit, cost)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              b.id,
              ing.item_name,
              ing.quantity,
              ing.unit,
              ing.cost,
            ]
          );
        }
      }

      const updatedItems = await pool.query(
        "SELECT * FROM mfg_bom_items WHERE bom_id=$1",
        [b.id]
      );

      return {
        ...b,
        ingredients: updatedItems.rows,
      };
    })()
  );
});
    // ══════════════════════════════════════════════════════════════════
    // WORK ORDERS
    // ══════════════════════════════════════════════════════════════════
    router.get("/work-orders", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_work_orders ORDER BY created_at DESC").then(r => r.rows)));

    router.post("/work-orders", async (req, res) => {
    const { wo_number, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes } = req.body;
    // Auto-generate WO number if not provided
    let woNum = wo_number;
    if (!woNum) {
        const cnt = await pool.query("SELECT COUNT(*) FROM mfg_work_orders");
        woNum = `WO-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, "0")}`;
    }
    send(res, pool.query(
        `INSERT INTO mfg_work_orders (wo_number, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
        [woNum, product_name, quantity, unit || "pcs", start_date, end_date, priority || "medium", status || "planned", assigned_team, progress || 0, notes]
    ).then(r => r.rows[0]));
    });

    router.put("/work-orders/:id", (req, res) => {
    const { wo_number, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes } = req.body;
    send(res, pool.query(
        `UPDATE mfg_work_orders SET wo_number=$1, product_name=$2, quantity=$3, unit=$4,
        start_date=$5, end_date=$6, priority=$7, status=$8, assigned_team=$9,
        progress=$10, notes=$11, updated_at=NOW() WHERE id=$12 RETURNING *`,
        [wo_number, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress || 0, notes, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/work-orders/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_work_orders WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // PRODUCTION RUNS
    // ══════════════════════════════════════════════════════════════════
    router.get("/production", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_production ORDER BY date DESC, created_at DESC").then(r => r.rows)));

    router.post("/production", async (req, res) => {
    const { ref_no, location, product, quantity, total_cost, date, recipe_used, notes } = req.body;
    let refNo = ref_no;
    if (!refNo) {
        const cnt = await pool.query("SELECT COUNT(*) FROM mfg_production");
        refNo = `PRD-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, "0")}`;
    }
    send(res, pool.query(
        `INSERT INTO mfg_production (ref_no, location, product, quantity, total_cost, date, recipe_used, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
        [refNo, location, product, quantity, total_cost, date, recipe_used, notes]
    ).then(r => r.rows[0]));
    });

    router.put("/production/:id", (req, res) => {
    const { ref_no, location, product, quantity, total_cost, date, recipe_used, notes } = req.body;
    send(res, pool.query(
        `UPDATE mfg_production SET ref_no=$1, location=$2, product=$3, quantity=$4,
        total_cost=$5, date=$6, recipe_used=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
        [ref_no, location, product, quantity, total_cost, date, recipe_used, notes, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/production/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_production WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // RESOURCES
    // ══════════════════════════════════════════════════════════════════
    router.get("/resources", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_resources ORDER BY name ASC").then(r => r.rows)));

    router.post("/resources", (req, res) => {
    const { name, type, capacity, shift, operator, status, notes } = req.body;
    send(res, pool.query(
        `INSERT INTO mfg_resources (name, type, capacity, shift, operator, status, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [name, type || "Machine", capacity, shift || "Morning", operator, status || "idle", notes]
    ).then(r => r.rows[0]));
    });

    router.put("/resources/:id", (req, res) => {
    const { name, type, capacity, shift, operator, status, notes } = req.body;
    send(res, pool.query(
        `UPDATE mfg_resources SET name=$1, type=$2, capacity=$3, shift=$4,
        operator=$5, status=$6, notes=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
        [name, type, capacity, shift, operator, status, notes, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/resources/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_resources WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // MACHINES
    // ══════════════════════════════════════════════════════════════════
    router.get("/machines", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_machines ORDER BY name ASC").then(r => r.rows)));

    router.post("/machines", (req, res) => {
    const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = req.body;
    send(res, pool.query(
        `INSERT INTO mfg_machines (name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
        [name, machine_code, type, location, manufacturer, model, purchase_date || null, status || "active", last_maintenance || null, next_maintenance || null, notes]
    ).then(r => r.rows[0]));
    });

    router.put("/machines/:id", (req, res) => {
    const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = req.body;
    send(res, pool.query(
        `UPDATE mfg_machines SET name=$1, machine_code=$2, type=$3, location=$4,
        manufacturer=$5, model=$6, purchase_date=$7, status=$8,
        last_maintenance=$9, next_maintenance=$10, notes=$11, updated_at=NOW() WHERE id=$12 RETURNING *`,
        [name, machine_code, type, location, manufacturer, model, purchase_date || null, status, last_maintenance || null, next_maintenance || null, notes, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/machines/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_machines WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // QUALITY CHECKS
    // ══════════════════════════════════════════════════════════════════
    router.get("/quality-checks", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_quality_checks ORDER BY inspection_date DESC").then(r => r.rows)));

    router.post("/quality-checks", async (req, res) => {
    const { ref_no, product, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = req.body;
    let refNo = ref_no;
    if (!refNo) {
        const cnt = await pool.query("SELECT COUNT(*) FROM mfg_quality_checks");
        refNo = `QC-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, "0")}`;
    }
    send(res, pool.query(
        `INSERT INTO mfg_quality_checks (ref_no, product, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
        [refNo, product, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed || 0, quantity_failed || 0, status || "pending", remarks]
    ).then(r => r.rows[0]));
    });

    router.put("/quality-checks/:id", (req, res) => {
    const { ref_no, product, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = req.body;
    send(res, pool.query(
        `UPDATE mfg_quality_checks SET ref_no=$1, product=$2, batch_no=$3, inspected_by=$4,
        inspection_date=$5, quantity_checked=$6, quantity_passed=$7, quantity_failed=$8,
        status=$9, remarks=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
        [ref_no, product, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/quality-checks/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_quality_checks WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // MAINTENANCE
    // ══════════════════════════════════════════════════════════════════
    router.get("/maintenance", (req, res) =>
    send(res, pool.query("SELECT * FROM mfg_maintenance ORDER BY scheduled_date DESC").then(r => r.rows)));

    router.post("/maintenance", async (req, res) => {
    const { ref_no, machine_name, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = req.body;
    let refNo = ref_no;
    if (!refNo) {
        const cnt = await pool.query("SELECT COUNT(*) FROM mfg_maintenance");
        refNo = `MNT-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, "0")}`;
    }
    send(res, pool.query(
        `INSERT INTO mfg_maintenance (ref_no, machine_name, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
        [refNo, machine_name, maintenance_type || "Preventive", technician, scheduled_date, completed_date || null, status || "scheduled", cost || null, description, notes]
    ).then(r => r.rows[0]));
    });

    router.put("/maintenance/:id", (req, res) => {
    const { ref_no, machine_name, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = req.body;
    send(res, pool.query(
        `UPDATE mfg_maintenance SET ref_no=$1, machine_name=$2, maintenance_type=$3, technician=$4,
        scheduled_date=$5, completed_date=$6, status=$7, cost=$8, description=$9, notes=$10, updated_at=NOW()
        WHERE id=$11 RETURNING *`,
        [ref_no, machine_name, maintenance_type, technician, scheduled_date, completed_date || null, status, cost || null, description, notes, req.params.id]
    ).then(r => r.rows[0]));
    });

    router.delete("/maintenance/:id", (req, res) =>
    send(res, pool.query("DELETE FROM mfg_maintenance WHERE id=$1", [req.params.id]).then(() => ({ success: true }))));

    // ══════════════════════════════════════════════════════════════════
    // REPORTS — Summary for Production Reports tab
    // ══════════════════════════════════════════════════════════════════
    router.get("/reports/summary", async (req, res) => {
    const { from, to } = req.query;
    const fromDate = from || "2000-01-01";
    const toDate   = to   || "2099-12-31";

    try {
        const [prodCount, prodQty, prodCost, woCompleted, topProducts, qcSummary] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM mfg_production WHERE date BETWEEN $1 AND $2", [fromDate, toDate]),
        pool.query("SELECT COALESCE(SUM(quantity),0) AS total FROM mfg_production WHERE date BETWEEN $1 AND $2", [fromDate, toDate]),
        pool.query("SELECT COALESCE(SUM(total_cost),0) AS total FROM mfg_production WHERE date BETWEEN $1 AND $2", [fromDate, toDate]),
        pool.query("SELECT COUNT(*) FROM mfg_work_orders WHERE status='completed' AND end_date BETWEEN $1 AND $2", [fromDate, toDate]),
        pool.query(
            `SELECT product, SUM(quantity) AS total_qty, SUM(total_cost) AS total_cost, COUNT(*) AS count
            FROM mfg_production WHERE date BETWEEN $1 AND $2
            GROUP BY product ORDER BY total_qty DESC LIMIT 10`,
            [fromDate, toDate]
        ),
        pool.query(
            `SELECT COALESCE(SUM(quantity_checked),0) AS total_checked,
                    COALESCE(SUM(quantity_passed),0)  AS total_passed,
                    COALESCE(SUM(quantity_failed),0)  AS total_failed
            FROM mfg_quality_checks WHERE inspection_date BETWEEN $1 AND $2`,
            [fromDate, toDate]
        ),
        ]);

        res.json({
        total_productions:  parseInt(prodCount.rows[0].count),
        total_quantity:     parseInt(prodQty.rows[0].total),
        total_cost:         parseFloat(prodCost.rows[0].total),
        completed_orders:   parseInt(woCompleted.rows[0].count),
        top_products:       topProducts.rows,
        qc_summary:         qcSummary.rows[0],
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: e.message });
    }
    });

    module.exports = router;