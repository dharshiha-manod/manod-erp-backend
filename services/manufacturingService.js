/**
 * ════════════════════════════════════════════════════════════════════
 * services/manufacturingService.js
 * ════════════════════════════════════════════════════════════════════
 * All business logic & DB access for the Manufacturing module.
 * Mirrors the pattern used in services/productService.js.
 *
 * Key addition vs the old inline routes/manufacturing.js:
 *   Production runs are now the stock-moving event.
 *   Saving a production run (with a linked BOM) will, in a single
 *   transaction:
 *     1. Lock + validate the finished product and every BOM component
 *     2. Deduct each component's quantity from products.current_stock
 *        (scaled to the quantity actually produced)
 *     3. Add the produced quantity to the finished product's stock
 *     4. Insert/update the mfg_production row
 *   Editing or deleting a production run first reverses its previous
 *   stock effect, then (for edits) re-applies the new one — so stock
 *   never drifts from double-counting.
 * ════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────
const nextRef = async (client, table, prefix) => {
  const cnt = await client.query(`SELECT COUNT(*) FROM ${table}`);
  return `${prefix}-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, '0')}`;
};

// ═══════════════════════════════════════════════════════════════════
// PRODUCTION PLANS  (unchanged logic, just relocated)
// ═══════════════════════════════════════════════════════════════════
const fetchPlans = () =>
  pool.query('SELECT * FROM mfg_plans ORDER BY created_at DESC').then(r => r.rows);

const createPlan = async (data) => {
  const { title, description, start_date, end_date, status, priority, assigned_team, product_id, target_quantity, bom_id } = data;
  if (!title?.trim()) throw new Error('Plan title is required');
  const r = await pool.query(
    `INSERT INTO mfg_plans (title, description, start_date, end_date, status, priority, assigned_team, product_id, target_quantity, bom_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
    [title, description || null, start_date, end_date, status || 'planned', priority || 'medium', assigned_team || null, product_id || null, target_quantity || 0, bom_id || null]
  );
  return r.rows[0];
};

const updatePlan = async (id, data) => {
  const { title, description, start_date, end_date, status, priority, assigned_team, product_id, target_quantity, bom_id } = data;
  const r = await pool.query(
    `UPDATE mfg_plans SET title=$1, description=$2, start_date=$3, end_date=$4,
     status=$5, priority=$6, assigned_team=$7, product_id=$8, target_quantity=$9, bom_id=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
    [title, description, start_date, end_date, status, priority, assigned_team, product_id || null, target_quantity || 0, bom_id || null, id]
  );
  if (!r.rows[0]) throw new Error('Plan not found');
  return r.rows[0];
};

const deletePlan = async (id) => {
  const r = await pool.query('DELETE FROM mfg_plans WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Plan not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// BILL OF MATERIALS
// Each ingredient may carry a product_id (linked raw material) — the
// item_name is stored as a snapshot for display/history purposes.
// ═══════════════════════════════════════════════════════════════════
const fetchBOMs = async () => {
  const boms  = await pool.query('SELECT * FROM mfg_bom ORDER BY created_at DESC');
  const items = await pool.query('SELECT * FROM mfg_bom_items ORDER BY id ASC');
  return boms.rows.map(b => ({
    ...b,
    ingredients: items.rows.filter(i => i.bom_id === b.id),
  }));
};

const fetchBOMById = async (id) => {
  const b = await pool.query('SELECT * FROM mfg_bom WHERE id=$1', [id]);
  if (!b.rows[0]) return null;
  const items = await pool.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1 ORDER BY id ASC', [id]);
  return { ...b.rows[0], ingredients: items.rows };
};

const _saveBomIngredients = async (client, bomId, ingredients = []) => {
  await client.query('DELETE FROM mfg_bom_items WHERE bom_id=$1', [bomId]);
  for (const ing of ingredients) {
    if (!ing.item_name && !ing.product_id) continue;
    await client.query(
      `INSERT INTO mfg_bom_items (bom_id, product_id, item_name, quantity, unit, cost)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [bomId, ing.product_id || null, ing.item_name || null, ing.quantity || 0, ing.unit || null, ing.cost || 0]
    );
  }
};

const createBOM = async (data) => {
  const { product_id, product_name, product_code, quantity, unit, version, status, notes, ingredients } = data;
  if (!product_name?.trim()) throw new Error('Finished product is required');
  if (!quantity || quantity <= 0) throw new Error('Base quantity must be greater than 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bom = await client.query(
      `INSERT INTO mfg_bom (product_id, product_name, product_code, quantity, unit, version, status, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [product_id || null, product_name, product_code || null, quantity, unit || 'pcs', version || '1.0', status || 'active', notes || null]
    );
    await _saveBomIngredients(client, bom.rows[0].id, ingredients);
    await client.query('COMMIT');
    return fetchBOMById(bom.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateBOM = async (id, data) => {
  const { product_id, product_name, product_code, quantity, unit, version, status, notes, ingredients } = data;
  const existing = await fetchBOMById(id);
  if (!existing) throw new Error('BOM not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE mfg_bom SET product_id=$1, product_name=$2, product_code=$3, quantity=$4, unit=$5,
       version=$6, status=$7, notes=$8, updated_at=NOW() WHERE id=$9`,
      [product_id || null, product_name, product_code, quantity, unit, version, status, notes, id]
    );
    if (ingredients !== undefined) await _saveBomIngredients(client, id, ingredients);
    await client.query('COMMIT');
    return fetchBOMById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteBOM = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mfg_bom_items WHERE bom_id=$1', [id]);
    const r = await client.query('DELETE FROM mfg_bom WHERE id=$1 RETURNING id', [id]);
    if (!r.rows[0]) throw new Error('BOM not found');
    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// WORK ORDERS  (product_id linked; no stock effect on its own)
// ═══════════════════════════════════════════════════════════════════
const fetchWorkOrders = () =>
  pool.query('SELECT * FROM mfg_work_orders ORDER BY created_at DESC').then(r => r.rows);

const createWorkOrder = async (data) => {
  const { wo_number, product_id, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes } = data;
  if (!product_name?.trim()) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');

  const woNum = wo_number || await nextRef(pool, 'mfg_work_orders', 'WO');
  const r = await pool.query(
    `INSERT INTO mfg_work_orders
     (wo_number, product_id, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
    [woNum, product_id || null, product_name, quantity, unit || 'pcs', start_date, end_date, priority || 'medium', status || 'planned', assigned_team || null, progress || 0, notes || null]
  );
  return r.rows[0];
};

const updateWorkOrder = async (id, data) => {
  const { wo_number, product_id, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_work_orders SET wo_number=$1, product_id=$2, product_name=$3, quantity=$4, unit=$5,
     start_date=$6, end_date=$7, priority=$8, status=$9, assigned_team=$10, progress=$11, notes=$12, updated_at=NOW()
     WHERE id=$13 RETURNING *`,
    [wo_number, product_id || null, product_name, quantity, unit, start_date, end_date, priority, status, assigned_team, progress || 0, notes, id]
  );
  if (!r.rows[0]) throw new Error('Work order not found');
  return r.rows[0];
};

const deleteWorkOrder = async (id) => {
  const r = await pool.query('DELETE FROM mfg_work_orders WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Work order not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// PRODUCTION RUNS — the stock-moving event
// ═══════════════════════════════════════════════════════════════════

// Deducts components for a BOM scaled to `quantity`, returns { totalCost, componentsUsed }
const _applyBomConsumption = async (client, bomId, quantity) => {
  const bomRes = await client.query('SELECT * FROM mfg_bom WHERE id=$1', [bomId]);
  const bom = bomRes.rows[0];
  if (!bom) throw new Error('Selected BOM/recipe not found');

  const itemsRes = await client.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1', [bomId]);
  const scale = parseFloat(quantity) / (parseFloat(bom.quantity) || 1);

  let totalCost = 0;
  const componentsUsed = [];

  for (const item of itemsRes.rows) {
    const needed = (parseFloat(item.quantity) || 0) * scale;
    totalCost += needed * (parseFloat(item.cost) || 0);

    if (item.product_id) {
      const compRes = await client.query(
        'SELECT id, name, current_stock FROM products WHERE id=$1 FOR UPDATE',
        [item.product_id]
      );
      const comp = compRes.rows[0];
      if (!comp) throw new Error(`Linked component product not found: ${item.item_name || 'unknown'}`);

      const newStock = parseFloat(comp.current_stock || 0) - needed;
      if (newStock < 0) {
        throw new Error(
          `Not enough stock for "${comp.name}". Available: ${comp.current_stock ?? 0}, needed: ${needed.toFixed(2)}`
        );
      }
      await client.query('UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2', [newStock, item.product_id]);
      componentsUsed.push({ product_id: item.product_id, name: comp.name, deducted: needed });
    }
  }

  return { totalCost, componentsUsed };
};

// Reverses the stock effect of a previously-saved production row (used before update/delete)
const _reverseProductionStock = async (client, prodRow) => {
  if (prodRow.product_id) {
    await client.query(
      'UPDATE products SET current_stock = current_stock - $1, updated_at=NOW() WHERE id=$2',
      [prodRow.quantity, prodRow.product_id]
    );
  }
  if (prodRow.bom_id) {
    const bomRes = await client.query('SELECT * FROM mfg_bom WHERE id=$1', [prodRow.bom_id]);
    const bom = bomRes.rows[0];
    if (bom) {
      const itemsRes = await client.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1', [prodRow.bom_id]);
      const scale = parseFloat(prodRow.quantity) / (parseFloat(bom.quantity) || 1);
      for (const item of itemsRes.rows) {
        if (item.product_id) {
          const needed = (parseFloat(item.quantity) || 0) * scale;
          await client.query(
            'UPDATE products SET current_stock = current_stock + $1, updated_at=NOW() WHERE id=$2',
            [needed, item.product_id]
          );
        }
      }
    }
  }
};

const fetchProduction = () =>
  pool.query('SELECT * FROM mfg_production ORDER BY date DESC, created_at DESC').then(r => r.rows);

const createProduction = async (data) => {
  const { ref_no, location, product_id, quantity, date, bom_id, notes } = data;
  if (!product_id) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prodRes = await client.query(
      'SELECT id, name, current_stock FROM products WHERE id=$1 FOR UPDATE',
      [product_id]
    );
    const finishedProduct = prodRes.rows[0];
    if (!finishedProduct) throw new Error('Selected product not found');

    let totalCost = 0;
    let componentsUsed = [];
    let recipeLabel = null;

    if (bom_id) {
      const applied = await _applyBomConsumption(client, bom_id, quantity);
      totalCost = applied.totalCost;
      componentsUsed = applied.componentsUsed;
      const bomRow = await client.query('SELECT product_code FROM mfg_bom WHERE id=$1', [bom_id]);
      recipeLabel = bomRow.rows[0]?.product_code || `BOM-${bom_id}`;
    } else if (data.total_cost) {
      totalCost = parseFloat(data.total_cost) || 0;
    }

    const newFinishedStock = parseFloat(finishedProduct.current_stock || 0) + parseFloat(quantity);
    await client.query('UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2', [newFinishedStock, product_id]);

    const refNo = ref_no || await nextRef(client, 'mfg_production', 'PRD');

    const insertRes = await client.query(
      `INSERT INTO mfg_production
       (ref_no, location, product, product_id, quantity, total_cost, date, recipe_used, bom_id, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
      [refNo, location || null, finishedProduct.name, product_id, quantity, totalCost, date, recipeLabel, bom_id || null, notes || null]
    );

    await client.query('COMMIT');
    return { ...insertRes.rows[0], components_used: componentsUsed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateProduction = async (id, data) => {
  const { ref_no, location, product_id, quantity, date, bom_id, notes } = data;
  if (!product_id) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query('SELECT * FROM mfg_production WHERE id=$1', [id]);
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Production record not found');

    // Reverse the old stock effect before applying the new one
    await _reverseProductionStock(client, existing);

    const prodRes = await client.query(
      'SELECT id, name, current_stock FROM products WHERE id=$1 FOR UPDATE',
      [product_id]
    );
    const finishedProduct = prodRes.rows[0];
    if (!finishedProduct) throw new Error('Selected product not found');

    let totalCost = 0;
    let recipeLabel = null;
    if (bom_id) {
      const applied = await _applyBomConsumption(client, bom_id, quantity);
      totalCost = applied.totalCost;
      const bomRow = await client.query('SELECT product_code FROM mfg_bom WHERE id=$1', [bom_id]);
      recipeLabel = bomRow.rows[0]?.product_code || `BOM-${bom_id}`;
    } else if (data.total_cost) {
      totalCost = parseFloat(data.total_cost) || 0;
    }

    const newFinishedStock = parseFloat(finishedProduct.current_stock || 0) + parseFloat(quantity);
    await client.query('UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2', [newFinishedStock, product_id]);

    const updateRes = await client.query(
      `UPDATE mfg_production SET ref_no=$1, location=$2, product=$3, product_id=$4, quantity=$5,
       total_cost=$6, date=$7, recipe_used=$8, bom_id=$9, notes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [ref_no || existing.ref_no, location || null, finishedProduct.name, product_id, quantity, totalCost, date, recipeLabel, bom_id || null, notes || null, id]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteProduction = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query('SELECT * FROM mfg_production WHERE id=$1', [id]);
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Production record not found');

    await _reverseProductionStock(client, existing);
    await client.query('DELETE FROM mfg_production WHERE id=$1', [id]);

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════
const fetchResources = () =>
  pool.query('SELECT * FROM mfg_resources ORDER BY name ASC').then(r => r.rows);

const createResource = async (data) => {
  const { name, type, capacity, shift, operator, status, notes } = data;
  if (!name?.trim()) throw new Error('Resource name is required');
  const r = await pool.query(
    `INSERT INTO mfg_resources (name, type, capacity, shift, operator, status, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
    [name, type || 'Machine', capacity || null, shift || 'Morning', operator || null, status || 'idle', notes || null]
  );
  return r.rows[0];
};

const updateResource = async (id, data) => {
  const { name, type, capacity, shift, operator, status, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_resources SET name=$1, type=$2, capacity=$3, shift=$4, operator=$5, status=$6, notes=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [name, type, capacity, shift, operator, status, notes, id]
  );
  if (!r.rows[0]) throw new Error('Resource not found');
  return r.rows[0];
};

const deleteResource = async (id) => {
  const r = await pool.query('DELETE FROM mfg_resources WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Resource not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// MACHINES
// ═══════════════════════════════════════════════════════════════════
const fetchMachines = () =>
  pool.query('SELECT * FROM mfg_machines ORDER BY name ASC').then(r => r.rows);

const createMachine = async (data) => {
  const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = data;
  if (!name?.trim()) throw new Error('Machine name is required');
  const r = await pool.query(
    `INSERT INTO mfg_machines (name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
    [name, machine_code || null, type || null, location || null, manufacturer || null, model || null, purchase_date || null, status || 'active', last_maintenance || null, next_maintenance || null, notes || null]
  );
  return r.rows[0];
};

const updateMachine = async (id, data) => {
  const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_machines SET name=$1, machine_code=$2, type=$3, location=$4, manufacturer=$5, model=$6,
     purchase_date=$7, status=$8, last_maintenance=$9, next_maintenance=$10, notes=$11, updated_at=NOW()
     WHERE id=$12 RETURNING *`,
    [name, machine_code, type, location, manufacturer, model, purchase_date || null, status, last_maintenance || null, next_maintenance || null, notes, id]
  );
  if (!r.rows[0]) throw new Error('Machine not found');
  return r.rows[0];
};
const deleteMachine = async (id) => {
  const r = await pool.query('DELETE FROM mfg_machines WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Machine not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// MACHINE DETAIL — full profile (specs + linked history in one call)
// ═══════════════════════════════════════════════════════════════════
const fetchMachineDetail = async (id) => {
  const machineRes = await pool.query('SELECT * FROM mfg_machines WHERE id=$1', [id]);
  const machine = machineRes.rows[0];
  if (!machine) return null;

  const [maintenance, logs, documents, qualityChecks] = await Promise.all([
    pool.query('SELECT * FROM mfg_maintenance WHERE machine_id=$1 ORDER BY scheduled_date DESC', [id]),
    pool.query('SELECT * FROM mfg_machine_logs WHERE machine_id=$1 ORDER BY start_time DESC LIMIT 200', [id]),
    pool.query('SELECT * FROM mfg_machine_documents WHERE machine_id=$1 ORDER BY uploaded_at DESC', [id]),
    pool.query(`SELECT * FROM mfg_quality_checks WHERE product IN (
      SELECT DISTINCT product FROM mfg_production WHERE ref_no IN (
        SELECT ref_no FROM mfg_machine_logs ml JOIN mfg_production p ON p.ref_no = p.ref_no WHERE ml.machine_id=$1
      )
    ) ORDER BY inspection_date DESC LIMIT 20`, [id]).catch(() => ({ rows: [] })),
  ]);

  return {
    ...machine,
    maintenance_history: maintenance.rows,
    logs: logs.rows,
    documents: documents.rows,
    related_quality_checks: qualityChecks.rows,
  };
};

// ─── Machine Logs (running / idle / downtime events) ───
const fetchMachineLogs = (machineId) =>
  pool.query('SELECT * FROM mfg_machine_logs WHERE machine_id=$1 ORDER BY start_time DESC', [machineId]).then(r => r.rows);

const createMachineLog = async (machineId, data) => {
  const { event_type, reason, start_time, end_time, units_produced, units_rejected, notes } = data;
  if (!event_type) throw new Error('Event type is required');
  if (!start_time) throw new Error('Start time is required');

  const r = await pool.query(
    `INSERT INTO mfg_machine_logs
     (machine_id, event_type, reason, start_time, end_time, units_produced, units_rejected, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
    [machineId, event_type, reason || null, start_time, end_time || null, units_produced || 0, units_rejected || 0, notes || null]
  );

  // Auto-sync machine status for live/downtime/maintenance events with no end_time yet
  if (!end_time) {
    const statusMap = { running: 'running', idle: 'idle', downtime: 'maintenance', maintenance: 'maintenance' };
    if (statusMap[event_type]) {
      await pool.query('UPDATE mfg_machines SET status=$1, updated_at=NOW() WHERE id=$2', [statusMap[event_type], machineId]);
    }
  }

  return r.rows[0];
};

const updateMachineLog = async (id, data) => {
  const { event_type, reason, start_time, end_time, units_produced, units_rejected, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_machine_logs SET event_type=$1, reason=$2, start_time=$3, end_time=$4,
     units_produced=$5, units_rejected=$6, notes=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
    [event_type, reason || null, start_time, end_time || null, units_produced || 0, units_rejected || 0, notes || null, id]
  );
  if (!r.rows[0]) throw new Error('Machine log not found');
  return r.rows[0];
};

const deleteMachineLog = async (id) => {
  const r = await pool.query('DELETE FROM mfg_machine_logs WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Machine log not found');
  return { success: true };
};

// ─── Machine Documents ───
const fetchMachineDocuments = (machineId) =>
  pool.query('SELECT * FROM mfg_machine_documents WHERE machine_id=$1 ORDER BY uploaded_at DESC', [machineId]).then(r => r.rows);

const createMachineDocument = async (machineId, data) => {
  const { doc_name, doc_url, doc_type } = data;
  if (!doc_name?.trim()) throw new Error('Document name is required');
  if (!doc_url?.trim()) throw new Error('Document URL is required');
  const r = await pool.query(
    `INSERT INTO mfg_machine_documents (machine_id, doc_name, doc_url, doc_type, uploaded_at)
     VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
    [machineId, doc_name, doc_url, doc_type || 'manual']
  );
  return r.rows[0];
};

const deleteMachineDocument = async (id) => {
  const r = await pool.query('DELETE FROM mfg_machine_documents WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Document not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// OEE / UTILIZATION DASHBOARD
// Standard formula: OEE = Availability × Performance × Quality
//   Availability = Run Time / Planned Production Time
//   Performance  = (Units Produced × Ideal Cycle Time) / Run Time
//   Quality      = Good Units / Total Units Produced
// We approximate Performance using rated_capacity as the "ideal rate".
// ═══════════════════════════════════════════════════════════════════
const fetchMachineOEE = async (machineId, from, to) => {
  const fromDate = from || '2000-01-01';
  const toDate   = to   || '2099-12-31';

  const machineRes = await pool.query('SELECT * FROM mfg_machines WHERE id=$1', [machineId]);
  const machine = machineRes.rows[0];
  if (!machine) throw new Error('Machine not found');

  const logsRes = await pool.query(
    `SELECT * FROM mfg_machine_logs
     WHERE machine_id=$1 AND start_time BETWEEN $2 AND $3 AND end_time IS NOT NULL`,
    [machineId, fromDate, toDate]
  );
  const logs = logsRes.rows;

  const toHours = (a, b) => (new Date(b) - new Date(a)) / 3600000;

  const plannedTime = logs.reduce((s, l) => s + toHours(l.start_time, l.end_time), 0);
  const runTime     = logs.filter(l => l.event_type === 'running').reduce((s, l) => s + toHours(l.start_time, l.end_time), 0);
  const downTime    = logs.filter(l => l.event_type === 'downtime' || l.event_type === 'maintenance').reduce((s, l) => s + toHours(l.start_time, l.end_time), 0);

  const unitsProduced = logs.reduce((s, l) => s + (parseInt(l.units_produced) || 0), 0);
  const unitsRejected = logs.reduce((s, l) => s + (parseInt(l.units_rejected) || 0), 0);
  const goodUnits = Math.max(0, unitsProduced - unitsRejected);

  const availability = plannedTime > 0 ? runTime / plannedTime : 0;
  const idealRate = parseFloat(machine.rated_capacity) || 0;
  const performance = (runTime > 0 && idealRate > 0) ? Math.min(1, unitsProduced / (idealRate * runTime)) : 0;
  const quality = unitsProduced > 0 ? goodUnits / unitsProduced : 0;

  const oee = availability * performance * quality;

  return {
    machine_id: machine.id,
    machine_name: machine.name,
    from: fromDate, to: toDate,
    planned_hours: Math.round(plannedTime * 100) / 100,
    run_hours: Math.round(runTime * 100) / 100,
    down_hours: Math.round(downTime * 100) / 100,
    units_produced: unitsProduced,
    units_rejected: unitsRejected,
    availability_pct: Math.round(availability * 10000) / 100,
    performance_pct: Math.round(performance * 10000) / 100,
    quality_pct: Math.round(quality * 10000) / 100,
    oee_pct: Math.round(oee * 10000) / 100,
    downtime_breakdown: logs
      .filter(l => l.event_type === 'downtime')
      .reduce((acc, l) => {
        const reason = l.reason || 'Unspecified';
        acc[reason] = (acc[reason] || 0) + toHours(l.start_time, l.end_time);
        return acc;
      }, {}),
  };
};

// Fleet-wide OEE summary for the top-level Machines dashboard
const fetchFleetOEE = async (from, to) => {
  const machines = await pool.query('SELECT id, name, status FROM mfg_machines ORDER BY name ASC');
  const results = await Promise.all(
    machines.rows.map(async m => {
      try { return await fetchMachineOEE(m.id, from, to); }
      catch { return { machine_id: m.id, machine_name: m.name, oee_pct: 0, availability_pct: 0, performance_pct: 0, quality_pct: 0, run_hours: 0, down_hours: 0, units_produced: 0 }; }
    })
  );
  const fleetAvgOEE = results.length ? results.reduce((s, r) => s + r.oee_pct, 0) / results.length : 0;
  return {
    fleet_average_oee: Math.round(fleetAvgOEE * 100) / 100,
    machines: results,
  };
};

// ═══════════════════════════════════════════════════════════════════
// QUALITY CHECKS
// ═══════════════════════════════════════════════════════════════════
const fetchQualityChecks = () =>
  pool.query('SELECT * FROM mfg_quality_checks ORDER BY inspection_date DESC').then(r => r.rows);

const createQualityCheck = async (data) => {
  const { ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = data;
  if (!product?.trim()) throw new Error('Product is required');
  if (!quantity_checked) throw new Error('Quantity checked is required');
  const refNo = ref_no || await nextRef(pool, 'mfg_quality_checks', 'QC');
  const r = await pool.query(
    `INSERT INTO mfg_quality_checks (ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
    [refNo, product, product_id || null, batch_no || null, inspected_by || null, inspection_date, quantity_checked, quantity_passed || 0, quantity_failed || 0, status || 'pending', remarks || null]
  );
  return r.rows[0];
};

const updateQualityCheck = async (id, data) => {
  const { ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = data;
  const r = await pool.query(
    `UPDATE mfg_quality_checks SET ref_no=$1, product=$2, product_id=$3, batch_no=$4, inspected_by=$5, inspection_date=$6,
     quantity_checked=$7, quantity_passed=$8, quantity_failed=$9, status=$10, remarks=$11, updated_at=NOW()
     WHERE id=$12 RETURNING *`,
    [ref_no, product, product_id || null, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, id]
  );
  if (!r.rows[0]) throw new Error('Quality check not found');
  return r.rows[0];
};

const deleteQualityCheck = async (id) => {
  const r = await pool.query('DELETE FROM mfg_quality_checks WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Quality check not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════
const fetchMaintenance = () =>
  pool.query('SELECT * FROM mfg_maintenance ORDER BY scheduled_date DESC').then(r => r.rows);

const createMaintenance = async (data) => {
  const { ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = data;
  if (!machine_name?.trim()) throw new Error('Machine name is required');
  if (!scheduled_date) throw new Error('Scheduled date is required');
  const refNo = ref_no || await nextRef(pool, 'mfg_maintenance', 'MNT');
  const r = await pool.query(
    `INSERT INTO mfg_maintenance (ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) RETURNING *`,
    [refNo, machine_name, machine_id || null, maintenance_type || 'Preventive', technician || null, scheduled_date, completed_date || null, status || 'scheduled', cost || null, description || null, notes || null]
  );
  return r.rows[0];
};

const updateMaintenance = async (id, data) => {
  const { ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_maintenance SET ref_no=$1, machine_name=$2, machine_id=$3, maintenance_type=$4, technician=$5,
     scheduled_date=$6, completed_date=$7, status=$8, cost=$9, description=$10, notes=$11, updated_at=NOW()
     WHERE id=$12 RETURNING *`,
    [ref_no, machine_name, machine_id || null, maintenance_type, technician, scheduled_date, completed_date || null, status, cost || null, description, notes, id]
  );
  if (!r.rows[0]) throw new Error('Maintenance record not found');
  return r.rows[0];
};

const deleteMaintenance = async (id) => {
  const r = await pool.query('DELETE FROM mfg_maintenance WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Maintenance record not found');
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════
const fetchReportsSummary = async (from, to) => {
  const fromDate = from || '2000-01-01';
  const toDate   = to   || '2099-12-31';

  const [prodCount, prodQty, prodCost, woCompleted, topProducts, qcSummary] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM mfg_production WHERE date BETWEEN $1 AND $2', [fromDate, toDate]),
    pool.query('SELECT COALESCE(SUM(quantity),0) AS total FROM mfg_production WHERE date BETWEEN $1 AND $2', [fromDate, toDate]),
    pool.query('SELECT COALESCE(SUM(total_cost),0) AS total FROM mfg_production WHERE date BETWEEN $1 AND $2', [fromDate, toDate]),
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

  return {
    total_productions: parseInt(prodCount.rows[0].count),
    total_quantity:    parseInt(prodQty.rows[0].total),
    total_cost:        parseFloat(prodCost.rows[0].total),
    completed_orders:  parseInt(woCompleted.rows[0].count),
    top_products:      topProducts.rows,
    qc_summary:        qcSummary.rows[0],
  };
};

// ═══════════════════════════════════════════════════════════════════
// SCHEDULE — dedicated manufacturing schedule entries (Schedule tab)
// ═══════════════════════════════════════════════════════════════════
const fetchSchedule = () =>
  pool.query('SELECT * FROM mfg_schedule ORDER BY start_date DESC, created_at DESC').then(r => r.rows);

const createSchedule = async (data) => {
  const { ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
          assigned_team, location, machine_name, priority, status, recurrence, notes } = data;
  if (!title?.trim()) throw new Error('Title is required');
  if (!start_date) throw new Error('Start date is required');
  const refNo = ref_no || await nextRef(pool, 'mfg_schedule', 'SCH');
  const r = await pool.query(
    `INSERT INTO mfg_schedule
     (ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
      assigned_team, location, machine_name, priority, status, recurrence, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
    [refNo, title, event_type || 'Production Run', product_name || null, start_date, end_date || null,
     start_time || null, end_time || null, assigned_team || null, location || null, machine_name || null,
     priority || 'medium', status || 'scheduled', recurrence || 'none', notes || null]
  );
  return r.rows[0];
};

const updateSchedule = async (id, data) => {
  const { ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
          assigned_team, location, machine_name, priority, status, recurrence, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_schedule SET ref_no=$1, title=$2, event_type=$3, product_name=$4, start_date=$5,
     end_date=$6, start_time=$7, end_time=$8, assigned_team=$9, location=$10, machine_name=$11,
     priority=$12, status=$13, recurrence=$14, notes=$15, updated_at=NOW() WHERE id=$16 RETURNING *`,
    [ref_no, title, event_type, product_name, start_date, end_date || null, start_time || null,
     end_time || null, assigned_team, location, machine_name, priority, status, recurrence, notes, id]
  );
  if (!r.rows[0]) throw new Error('Schedule entry not found');
  return r.rows[0];
};

const deleteSchedule = async (id) => {
  const r = await pool.query('DELETE FROM mfg_schedule WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw new Error('Schedule entry not found');
  return { success: true };
};

// ─────────────────────────────────────────────────────────────
module.exports = {
  // Plans
  fetchPlans, createPlan, updatePlan, deletePlan,
  // BOM
  fetchBOMs, fetchBOMById, createBOM, updateBOM, deleteBOM,
  // Work Orders
  fetchWorkOrders, createWorkOrder, updateWorkOrder, deleteWorkOrder,
  // Production (transactional stock logic)
  fetchProduction, createProduction, updateProduction, deleteProduction,
  // Resources
  fetchResources, createResource, updateResource, deleteResource,
// Machines
  fetchMachines, createMachine, updateMachine, deleteMachine,
  fetchMachineDetail,
  fetchMachineLogs, createMachineLog, updateMachineLog, deleteMachineLog,
  fetchMachineDocuments, createMachineDocument, deleteMachineDocument,
  fetchMachineOEE, fetchFleetOEE,
  // Quality Checks
  fetchQualityChecks, createQualityCheck, updateQualityCheck, deleteQualityCheck,
// Maintenance
  fetchMaintenance, createMaintenance, updateMaintenance, deleteMaintenance,
  // Schedule
  fetchSchedule, createSchedule, updateSchedule, deleteSchedule,
  // Reports
  fetchReportsSummary,
};