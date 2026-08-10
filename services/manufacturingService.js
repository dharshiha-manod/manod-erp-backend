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
const { logActivity } = require('./activityLogService');
const notificationEngine = require('./notificationEngine');
// Used to auto-raise Purchase Orders when a Work Order's BOM components
// are short on stock (see createPurchaseOrderFromShortfall below).
const purchaseService = require('./purchaseService');
const stockLocationService = require('./stockLocationService');

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────
// NEW
const nextRef = async (client, table, prefix, industryId) => {
  const refCol = table === 'mfg_work_orders' ? 'wo_number' : 'ref_no';
  const res = await client.query(
    `SELECT ${refCol} AS ref FROM ${table} WHERE industry_id = $1 AND ${refCol} LIKE $2`,
    [industryId, `${prefix}-%`]
  );

  let next = 1;
  for (const row of res.rows) {
    const numPart = String(row.ref).replace(/^\D+-?/, '');
    const n = parseInt(numPart, 10);
    if (!isNaN(n) && n >= next) next = n + 1;
  }

  let candidate = `${prefix}-${String(next).padStart(4, '0')}`;
  while (true) {
    const exists = await client.query(
      `SELECT 1 FROM ${table} WHERE industry_id = $1 AND ${refCol} = $2 LIMIT 1`,
      [industryId, candidate]
    );
    if (exists.rows.length === 0) break;
    next += 1;
    candidate = `${prefix}-${String(next).padStart(4, '0')}`;
  }
  return candidate;
};

// ─────────────────────────────────────────────────────────────
// Resource / Machine availability guard
// ─────────────────────────────────────────────────────────────
// NEW
const _assertMachinesAvailable = async (client, machineIds = [], industryId) => {
  if (!machineIds.length) return;
  const res = await client.query(
    `SELECT id, name, status FROM mfg_machines WHERE id = ANY($1::int[]) AND industry_id = $2`,
    [machineIds, industryId]
  );
  if (res.rows.length !== machineIds.length) {
    throw new Error('One or more selected machines do not belong to the active workspace');
  }
  const blocked = res.rows.filter(m => m.status === 'maintenance');
  if (blocked.length) {
    throw new Error(
      `Cannot assign — machine(s) under maintenance: ${blocked.map(m => m.name).join(', ')}`
    );
  }
};

const _assertResourcesAvailable = async (client, resourceIds = [], industryId) => {
  if (!resourceIds.length) return;
  const res = await client.query(
    `SELECT id, name, status FROM mfg_resources WHERE id = ANY($1::int[]) AND industry_id = $2`,
    [resourceIds, industryId]
  );
  if (res.rows.length !== resourceIds.length) {
    throw new Error('One or more selected resources do not belong to the active workspace');
  }
  const blocked = res.rows.filter(r => r.status === 'maintenance');
  if (blocked.length) {
    throw new Error(
      `Cannot assign — resource(s) unavailable: ${blocked.map(r => r.name).join(', ')}`
    );
  }
};

// Overlap check: same machine can't be double-booked in the plan window
const _assertNoScheduleOverlap = async (client, machineIds, startDate, endDate, excludePlanId = null, industryId) => {
  if (!machineIds?.length || !startDate || !endDate) return;
  const res = await client.query(
    `SELECT pm.machine_id, m.name, p.title, p.start_date, p.end_date
     FROM mfg_plan_machines pm
     JOIN mfg_plans p ON p.id = pm.plan_id
     JOIN mfg_machines m ON m.id = pm.machine_id
     WHERE pm.machine_id = ANY($1::int[])
       AND p.industry_id = $5
       AND p.id != COALESCE($4, -1)
       AND p.status NOT IN ('completed', 'on_hold')
       AND daterange(p.start_date, p.end_date, '[]') && daterange($2::date, $3::date, '[]')`,
    [machineIds, startDate, endDate, excludePlanId, industryId]
  );
  if (res.rows.length) {
    const r = res.rows[0];
    throw new Error(`Machine "${r.name}" is already scheduled on plan "${r.title}" (${r.start_date?.toISOString?.().slice(0,10) || r.start_date} → ${r.end_date?.toISOString?.().slice(0,10) || r.end_date})`);
  }
};

const _setMachinesStatus = async (client, machineIds = [], status) => {
  if (!machineIds.length) return;
  await client.query(
    `UPDATE mfg_machines SET status=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND status != 'maintenance'`,
    [status, machineIds]
  );
};

const _setResourcesStatus = async (client, resourceIds = [], status) => {
  if (!resourceIds.length) return;
  await client.query(
    `UPDATE mfg_resources SET status=$1, updated_at=NOW() WHERE id = ANY($2::int[]) AND status != 'maintenance'`,
    [status, resourceIds]
  );
};

const _getPlanMachineIds = (client, planId) =>
  client.query('SELECT machine_id FROM mfg_plan_machines WHERE plan_id=$1', [planId]).then(r => r.rows.map(x => x.machine_id));
const _getPlanResourceIds = (client, planId) =>
  client.query('SELECT resource_id FROM mfg_plan_resources WHERE plan_id=$1', [planId]).then(r => r.rows.map(x => x.resource_id));
const _getWoMachineIds = (client, woId) =>
  client.query('SELECT machine_id FROM mfg_wo_machines WHERE wo_id=$1', [woId]).then(r => r.rows.map(x => x.machine_id));
const _getWoResourceIds = (client, woId) =>
  client.query('SELECT resource_id FROM mfg_wo_resources WHERE wo_id=$1', [woId]).then(r => r.rows.map(x => x.resource_id));

// Shared: save many-to-many links for plan/WO ↔ resources/machines
const _saveLinks = async (client, table, planCol, planId, otherCol, ids = []) => {
  await client.query(`DELETE FROM ${table} WHERE ${planCol}=$1`, [planId]);
  for (const id of ids) {
    await client.query(`INSERT INTO ${table} (${planCol}, ${otherCol}) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [planId, id]);
  }
};
// ═══════════════════════════════════════════════════════════════════
// PRODUCTION PLANS  (unchanged logic, just relocated)
// ═══════════════════════════════════════════════════════════════════
// NEW
const fetchPlans = async (industryId) => {
  const plans = await pool.query('SELECT * FROM mfg_plans WHERE industry_id=$1 ORDER BY created_at DESC', [industryId]);
  const resourceLinks = await pool.query(
    'SELECT pr.* FROM mfg_plan_resources pr JOIN mfg_plans p ON p.id = pr.plan_id WHERE p.industry_id=$1',
    [industryId]
  );
  const machineLinks = await pool.query(
    'SELECT pm.* FROM mfg_plan_machines pm JOIN mfg_plans p ON p.id = pm.plan_id WHERE p.industry_id=$1',
    [industryId]
  );
  return plans.rows.map(p => ({
    ...p,
    resource_ids: resourceLinks.rows.filter(x => x.plan_id === p.id).map(x => x.resource_id),
    machine_ids:  machineLinks.rows.filter(x => x.plan_id === p.id).map(x => x.machine_id),
  }));
};

const fetchPlanById = async (id, industryId) => {
  const p = await pool.query('SELECT * FROM mfg_plans WHERE id=$1 AND industry_id=$2', [id, industryId]);
  if (!p.rows[0]) return null;
  const resourceLinks = await pool.query('SELECT resource_id FROM mfg_plan_resources WHERE plan_id=$1', [id]);
  const machineLinks  = await pool.query('SELECT machine_id FROM mfg_plan_machines WHERE plan_id=$1', [id]);
  return {
    ...p.rows[0],
    resource_ids: resourceLinks.rows.map(x => x.resource_id),
    machine_ids: machineLinks.rows.map(x => x.machine_id),
  };
};

const createPlan = async (industryId, data) => {
  const {
    title, description, start_date, end_date, status, priority, assigned_team,
    product_id, target_quantity, bom_id, work_center, estimated_hours,
    resource_ids = [], machine_ids = [],
  } = data;
  if (!title?.trim()) throw new Error('Plan title is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

await _assertMachinesAvailable(client, machine_ids, industryId);
await _assertResourcesAvailable(client, resource_ids, industryId);
    await _assertNoScheduleOverlap(client, machine_ids, start_date, end_date, null, industryId);

    // Product must belong to the active workspace
    if (product_id) {
      const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
      if (!prodCheck.rows[0]) throw new Error('Selected product does not belong to the active workspace');
    }

    // Auto-load BOM for the product if bom_id not explicitly given
    let resolvedBomId = bom_id || null;
    if (!resolvedBomId && product_id) {
      const bomRes = await client.query(
        'SELECT id FROM mfg_bom WHERE product_id=$1 AND industry_id=$2 ORDER BY created_at DESC LIMIT 1',
        [product_id, industryId]
      );
      resolvedBomId = bomRes.rows[0]?.id || null;
    } else if (resolvedBomId) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [resolvedBomId, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    const r = await client.query(
      `INSERT INTO mfg_plans (industry_id, title, description, start_date, end_date, status, priority, assigned_team, product_id, target_quantity, bom_id, work_center, estimated_hours, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING *`,
      [industryId, title, description || null, start_date, end_date, status || 'planned', priority || 'medium', assigned_team || null, product_id || null, target_quantity || 0, resolvedBomId, work_center || null, estimated_hours || null]
    );
    const plan = r.rows[0];

    await _saveLinks(client, 'mfg_plan_resources', 'plan_id', plan.id, 'resource_id', resource_ids);
    await _saveLinks(client, 'mfg_plan_machines', 'plan_id', plan.id, 'machine_id', machine_ids);

    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Created Production Plan ${plan.title}`, detail: `Target: ${plan.target_quantity || 0}` });
    return fetchPlanById(plan.id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updatePlan = async (industryId, id, data) => {
  const {
    title, description, start_date, end_date, status, priority, assigned_team,
    product_id, target_quantity, bom_id, work_center, estimated_hours,
    resource_ids = [], machine_ids = [],
  } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM mfg_plans WHERE id=$1 AND industry_id=$2', [id, industryId]);
    if (!existing.rows[0]) throw new Error('Plan not found');

await _assertMachinesAvailable(client, machine_ids, industryId);
await _assertResourcesAvailable(client, resource_ids, industryId);
    await _assertNoScheduleOverlap(client, machine_ids, start_date, end_date, id, industryId);

    if (product_id) {
      const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
      if (!prodCheck.rows[0]) throw new Error('Selected product does not belong to the active workspace');
    }
    if (bom_id) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    const r = await client.query(
      `UPDATE mfg_plans SET title=$1, description=$2, start_date=$3, end_date=$4,
       status=$5, priority=$6, assigned_team=$7, product_id=$8, target_quantity=$9, bom_id=$10,
       work_center=$11, estimated_hours=$12, updated_at=NOW() WHERE id=$13 AND industry_id=$14 RETURNING *`,
      [title, description, start_date, end_date, status, priority, assigned_team, product_id || null, target_quantity || 0, bom_id || null, work_center || null, estimated_hours || null, id, industryId]
    );
    if (!r.rows[0]) throw new Error('Plan not found');

    await _saveLinks(client, 'mfg_plan_resources', 'plan_id', id, 'resource_id', resource_ids);
    await _saveLinks(client, 'mfg_plan_machines', 'plan_id', id, 'machine_id', machine_ids);

    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Updated Production Plan ${r.rows[0].title}`, detail: `Status: ${r.rows[0].status}` });
    return fetchPlanById(id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deletePlan = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_plans WHERE id=$1 AND industry_id=$2 RETURNING id, title', [id, industryId]);
  if (!r.rows[0]) throw new Error('Plan not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Production Plan ${r.rows[0].title}` });
  return { success: true };
};
// ═══════════════════════════════════════════════════════════════════
// BILL OF MATERIALS
// Each ingredient may carry a product_id (linked raw material) — the
// item_name is stored as a snapshot for display/history purposes.
// ═══════════════════════════════════════════════════════════════════
// NEW
const fetchBOMs = async (industryId) => {
  const boms  = await pool.query('SELECT * FROM mfg_bom WHERE industry_id=$1 ORDER BY created_at DESC', [industryId]);
  const items = await pool.query(
    'SELECT bi.* FROM mfg_bom_items bi JOIN mfg_bom b ON b.id = bi.bom_id WHERE b.industry_id=$1 ORDER BY bi.id ASC',
    [industryId]
  );
  return boms.rows.map(b => ({
    ...b,
    ingredients: items.rows.filter(i => i.bom_id === b.id),
  }));
};

const fetchBOMById = async (id, industryId) => {
  const b = await pool.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [id, industryId]);
  if (!b.rows[0]) return null;
  const items = await pool.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1 ORDER BY id ASC', [id]);
  return { ...b.rows[0], ingredients: items.rows };
};

const _saveBomIngredients = async (client, bomId, ingredients = [], industryId) => {
  await client.query('DELETE FROM mfg_bom_items WHERE bom_id=$1', [bomId]);
  for (const ing of ingredients) {
    if (!ing.item_name && !ing.product_id) continue;
    if (ing.product_id) {
      const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [ing.product_id, industryId]);
      if (!prodCheck.rows[0]) throw new Error(`Ingredient product "${ing.item_name || ing.product_id}" does not belong to the active workspace`);
    }
    await client.query(
      `INSERT INTO mfg_bom_items (bom_id, product_id, item_name, quantity, unit, cost, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bomId, ing.product_id || null, ing.item_name || null, ing.quantity || 0, ing.unit || null, ing.cost || 0, industryId]
    );
  }
};
const createBOM = async (industryId, data) => {
  const { product_id, product_name, product_code, quantity, unit, version, status, notes, ingredients } = data;
  if (!product_name?.trim()) throw new Error('Finished product is required');
  if (!quantity || quantity <= 0) throw new Error('Base quantity must be greater than 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (product_id) {
      const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
      if (!prodCheck.rows[0]) throw new Error('Finished product does not belong to the active workspace');
    }

    const bom = await client.query(
      `INSERT INTO mfg_bom (industry_id, product_id, product_name, product_code, quantity, unit, version, status, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
      [industryId, product_id || null, product_name, product_code || null, quantity, unit || 'pcs', version || '1.0', status || 'active', notes || null]
    );
    await _saveBomIngredients(client, bom.rows[0].id, ingredients, industryId);
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Created BOM for ${product_name}`, detail: `Code: ${product_code || ''}` });
    return fetchBOMById(bom.rows[0].id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateBOM = async (industryId, id, data) => {
  const { product_id, product_name, product_code, quantity, unit, version, status, notes, ingredients } = data;
  const existing = await fetchBOMById(id, industryId);
  if (!existing) throw new Error('BOM not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (product_id) {
      const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
      if (!prodCheck.rows[0]) throw new Error('Finished product does not belong to the active workspace');
    }

    await client.query(
      `UPDATE mfg_bom SET product_id=$1, product_name=$2, product_code=$3, quantity=$4, unit=$5,
       version=$6, status=$7, notes=$8, updated_at=NOW() WHERE id=$9 AND industry_id=$10`,
      [product_id || null, product_name, product_code, quantity, unit, version, status, notes, id, industryId]
    );
    if (ingredients !== undefined) await _saveBomIngredients(client, id, ingredients, industryId);
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Updated BOM for ${product_name}`, detail: `Code: ${product_code || ''}` });
    return fetchBOMById(id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteBOM = async (industryId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE mfg_plans SET bom_id=NULL WHERE bom_id=$1 AND industry_id=$2', [id, industryId]);
    await client.query('DELETE FROM mfg_bom_items WHERE bom_id=$1', [id]);
    const r = await client.query('DELETE FROM mfg_bom WHERE id=$1 AND industry_id=$2 RETURNING id, product_name', [id, industryId]);
    if (!r.rows[0]) throw new Error('BOM not found');
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Deleted BOM for ${r.rows[0].product_name}` });
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════
// WORK ORDERS — now inherits product/BOM/resources/machines from Plan
// ═══════════════════════════════════════════════════════════════════
// NEW
const fetchWorkOrders = async (industryId) => {
  const wos = await pool.query('SELECT * FROM mfg_work_orders WHERE industry_id=$1 ORDER BY created_at DESC', [industryId]);
  const resourceLinks = await pool.query(
    'SELECT wr.* FROM mfg_wo_resources wr JOIN mfg_work_orders w ON w.id = wr.wo_id WHERE w.industry_id=$1',
    [industryId]
  );
  const machineLinks = await pool.query(
    'SELECT wm.* FROM mfg_wo_machines wm JOIN mfg_work_orders w ON w.id = wm.wo_id WHERE w.industry_id=$1',
    [industryId]
  );
  return wos.rows.map(w => ({
    ...w,
    resource_ids: resourceLinks.rows.filter(x => x.wo_id === w.id).map(x => x.resource_id),
    machine_ids:  machineLinks.rows.filter(x => x.wo_id === w.id).map(x => x.machine_id),
  }));
};

const fetchWorkOrderById = async (id, industryId) => {
  const w = await pool.query('SELECT * FROM mfg_work_orders WHERE id=$1 AND industry_id=$2', [id, industryId]);
  if (!w.rows[0]) return null;
  const resourceIds = await _getWoResourceIds(pool, id);
  const machineIds  = await _getWoMachineIds(pool, id);
  return { ...w.rows[0], resource_ids: resourceIds, machine_ids: machineIds };
};

// Creating a WO from a plan_id auto-inherits product, qty, BOM, resources,
// machines, team and timeline — none of these need to be re-entered.
const createWorkOrder = async (industryId, data) => {
  let {
    wo_number, plan_id, product_id, product_name, quantity, unit,
    start_date, end_date, priority, status, assigned_team, progress, notes,
    bom_id, resource_ids, machine_ids,
  } = data;
  wo_number = undefined; // always auto-generate on create — never trust a client-supplied number

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Inherit everything from the linked Production Plan if plan_id given
    if (plan_id) {
      const planRes = await client.query('SELECT * FROM mfg_plans WHERE id=$1 AND industry_id=$2', [plan_id, industryId]);
      const plan = planRes.rows[0];
      if (!plan) throw new Error('Linked production plan not found');

      product_id     = product_id     ?? plan.product_id;
      quantity       = quantity       ?? plan.target_quantity;
      bom_id         = bom_id         ?? plan.bom_id;
      start_date     = start_date     ?? plan.start_date;
      end_date       = end_date       ?? plan.end_date;
      assigned_team  = assigned_team  ?? plan.assigned_team;
      priority       = priority       ?? plan.priority;

      if (!resource_ids?.length) resource_ids = await _getPlanResourceIds(client, plan_id);
      if (!machine_ids?.length)  machine_ids  = await _getPlanMachineIds(client, plan_id);
    }
    resource_ids = resource_ids || [];
    machine_ids  = machine_ids  || [];

    if (!product_id) throw new Error('Product is required');
    if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');

    const p = await client.query('SELECT name FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
    if (!p.rows[0]) throw new Error('Selected product does not belong to the active workspace');
    if (!product_name) product_name = p.rows[0].name;

    if (bom_id) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    await _assertMachinesAvailable(client, machine_ids, industryId);
    await _assertResourcesAvailable(client, resource_ids, industryId);

  const woNumber = await nextRef(client, 'mfg_work_orders', 'WO', industryId);

    const r = await client.query(
      `INSERT INTO mfg_work_orders
       (industry_id, wo_number, plan_id, product_id, product_name, quantity, unit, bom_id,
        start_date, end_date, priority, status, assigned_team, progress, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
      [industryId, woNumber, plan_id || null, product_id, product_name, quantity, unit || 'pcs', bom_id || null,
       start_date || null, end_date || null, priority || 'medium', status || 'planned',
       assigned_team || null, progress || 0, notes || null]
    );
    const wo = r.rows[0];

   await _saveLinks(client, 'mfg_wo_resources', 'wo_id', wo.id, 'resource_id', resource_ids);
    await _saveLinks(client, 'mfg_wo_machines', 'wo_id', wo.id, 'machine_id', machine_ids);

    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Created Work Order ${wo.wo_number}`, detail: `${wo.product_name || ''} × ${wo.quantity}` });
    return fetchWorkOrderById(wo.id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateWorkOrder = async (industryId, id, data) => {
  const {
    wo_number, product_id, product_name, quantity, unit, bom_id,
    start_date, end_date, priority, status, assigned_team, progress, notes,
    resource_ids = [], machine_ids = [],
  } = data;
  if (!product_id) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM mfg_work_orders WHERE id=$1 AND industry_id=$2', [id, industryId]);
    if (!existing.rows[0]) throw new Error('Work order not found');

    const prodCheck = await client.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
    if (!prodCheck.rows[0]) throw new Error('Selected product does not belong to the active workspace');
    if (bom_id) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    await _assertMachinesAvailable(client, machine_ids, industryId);
    await _assertResourcesAvailable(client, resource_ids, industryId);

    const r = await client.query(
      `UPDATE mfg_work_orders SET wo_number=$1, product_id=$2, product_name=$3, quantity=$4, unit=$5,
       bom_id=$6, start_date=$7, end_date=$8, priority=$9, status=$10, assigned_team=$11,
       progress=$12, notes=$13, updated_at=NOW() WHERE id=$14 AND industry_id=$15 RETURNING *`,
      [wo_number, product_id, product_name, quantity, unit, bom_id || null, start_date || null,
       end_date || null, priority, status, assigned_team || null, progress || 0, notes || null, id, industryId]
    );
    if (!r.rows[0]) throw new Error('Work order not found');

    await _saveLinks(client, 'mfg_wo_resources', 'wo_id', id, 'resource_id', resource_ids);
    await _saveLinks(client, 'mfg_wo_machines', 'wo_id', id, 'machine_id', machine_ids);

    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Updated Work Order ${r.rows[0].wo_number}`, detail: `Status: ${r.rows[0].status}` });
    return fetchWorkOrderById(id, industryId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteWorkOrder = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_work_orders WHERE id=$1 AND industry_id=$2 RETURNING id, wo_number', [id, industryId]);
  if (!r.rows[0]) throw new Error('Work order not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Work Order ${r.rows[0].wo_number}` });
  return { success: true };
};

// ─────────────────────────────────────────────────────────────
// MAKE-TO-ORDER HOOK — called from services/sellService.js the moment a
// sale can't be fulfilled from stock. If the product has an active BOM
// (i.e. it's something we manufacture, not just stock), auto-raise a
// high-priority Work Order for the shortfall instead of only failing the
// sale. Returns null (does nothing) if there's no recipe to build from —
// callers should still surface the original "insufficient stock" error.
const autoCreateWorkOrderForShortfall = async ({ industryId, productId, shortfallQty, note }) => {
  if (!industryId || !productId || !shortfallQty || shortfallQty <= 0) return null;
  const bomRes = await pool.query(
    `SELECT id FROM mfg_bom WHERE product_id=$1 AND industry_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1`,
    [productId, industryId]
  );
  const bom = bomRes.rows[0];
  if (!bom) return null;

  const qty = Math.ceil(shortfallQty);
  const today = new Date().toISOString().slice(0, 10);
  try {
    return await createWorkOrder(industryId, {
      product_id: productId,
      quantity: qty,
      bom_id: bom.id,
      start_date: today,
      priority: 'high',
      status: 'planned',
      notes: note || `Auto-created — insufficient stock to fulfil a sale (short by ${qty} units).`,
    });
  } catch (err) {
    // Never let a make-to-order convenience feature break the sale flow —
    // log and swallow (e.g. a machine under maintenance blocking assignment).
    console.error('[autoCreateWorkOrderForShortfall] failed:', err.message);
    return null;
  }
};
// ═══════════════════════════════════════════════════════════════════
// WORK ORDERS  (product_id linked; no stock effect on its own)
// ═══════════════════════════════════════════════════════════════════
// Start a production run tied to a Work Order — flips machines/resources to "running"
// Checks BOM material availability for a WO's quantity without deducting
// anything — used as a gate before flipping machines/resources to running.
// NEW
const _assertMaterialsAvailable = async (client, bomId, quantity, industryId) => {
  if (!bomId) return;
  const bomRes = await client.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bomId, industryId]);
  const bom = bomRes.rows[0];
  if (!bom) return;

  const itemsRes = await client.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1', [bomId]);
  const scale = parseFloat(quantity) / (parseFloat(bom.quantity) || 1);
  const shortages = [];

  for (const item of itemsRes.rows) {
    if (!item.product_id) continue;
    const needed = (parseFloat(item.quantity) || 0) * scale;
    const compRes = await client.query('SELECT name, current_stock FROM products WHERE id=$1 AND industry_id=$2', [item.product_id, industryId]);
    const comp = compRes.rows[0];
    if (!comp) continue;
    const available = parseFloat(comp.current_stock || 0);
    if (available < needed) {
      shortages.push(`${comp.name}: need ${needed.toFixed(2)}, have ${available}`);
    }
  }

  if (shortages.length) {
    throw new Error(`Cannot start production — insufficient raw material stock: ${shortages.join('; ')}`);
  }
};

const _computeBomShortfall = async (bomId, quantity, industryId) => {
  const bomRes = await pool.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bomId, industryId]);
  const bom = bomRes.rows[0];
  if (!bom) throw new Error('BOM/recipe not found');

  const itemsRes = await pool.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1', [bomId]);
  const scale = parseFloat(quantity) / (parseFloat(bom.quantity) || 1);
  const shortfalls = [];

  for (const item of itemsRes.rows) {
    if (!item.product_id) continue;
    const needed = (parseFloat(item.quantity) || 0) * scale;
    const compRes = await pool.query(
      'SELECT id, name, current_stock, default_supplier_id, purchase_price_exc_tax FROM products WHERE id=$1 AND industry_id=$2',
      [item.product_id, industryId]
    );
    const comp = compRes.rows[0];
    if (!comp) continue;
    const available = parseFloat(comp.current_stock) || 0;
    const shortBy = needed - available;
    if (shortBy > 0.0001) {
      shortfalls.push({
        product_id: comp.id,
        name: comp.name,
        needed,
        available,
        short_by: shortBy,
        default_supplier_id: comp.default_supplier_id,
        unit_cost: parseFloat(comp.purchase_price_exc_tax) || 0,
      });
    }
  }
  return shortfalls;
};

const createPurchaseOrderFromShortfall = async (industryId, woId, userId) => {
  const woRes = await pool.query('SELECT * FROM mfg_work_orders WHERE id=$1 AND industry_id=$2', [woId, industryId]);
  const wo = woRes.rows[0];
  if (!wo) throw new Error('Work order not found');
  if (!wo.bom_id) throw new Error('This work order has no BOM/recipe linked — nothing to check for shortage.');

  const producedPct = parseFloat(wo.progress) || 0;
  const remainingQty = parseFloat(wo.quantity) * (1 - producedPct / 100);
  const qtyToCheck = remainingQty > 0 ? remainingQty : parseFloat(wo.quantity);

  const shortfalls = await _computeBomShortfall(wo.bom_id, qtyToCheck, industryId);
  if (shortfalls.length === 0) {
    return { created: [], unassigned: [], message: 'No shortage detected — all components have enough stock for the remaining quantity.' };
  }

  const bySupplier = {};
  const unassigned = [];
  for (const s of shortfalls) {
    if (s.default_supplier_id) (bySupplier[s.default_supplier_id] ||= []).push(s);
    else unassigned.push(s);
  }

  const created = [];
  for (const [supplierId, items] of Object.entries(bySupplier)) {
    const po = await purchaseService.createPurchase(industryId, {
      supplier_id: parseInt(supplierId),
      purchase_status: 'Pending',
      notes: `Auto-generated: material shortage for Work Order ${wo.wo_number}`,
      items: items.map(i => ({
        product_id: i.product_id,
        product_name: i.name,
        quantity: Math.ceil(i.short_by),
        unit_cost: i.unit_cost,
      })),
    }, userId);
    created.push(po);
  }

  logActivity({
    module: 'Manufacturing',
    action: `Auto-PO for shortage on ${wo.wo_number}`,
    detail: `${created.length} purchase order(s), ${unassigned.length} item(s) with no default supplier`,
  });

  return {
    created,
    unassigned,
    message: created.length
      ? `${created.length} purchase order${created.length > 1 ? 's' : ''} created for the shortage.` +
        (unassigned.length ? ` ${unassigned.length} item(s) skipped — set a default supplier on that Product.` : '')
      : 'Shortage found, but none of the components have a default supplier set. Add one on the Product record to auto-generate a PO.',
  };
};

const startProductionRun = async (industryId, woId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const woRes = await client.query('SELECT * FROM mfg_work_orders WHERE id=$1 AND industry_id=$2', [woId, industryId]);
    const wo = woRes.rows[0];
    if (!wo) throw new Error('Work order not found');

    const machineIds  = await _getWoMachineIds(client, woId);
    const resourceIds = await _getWoResourceIds(client, woId);
    await _assertMachinesAvailable(client, machineIds, industryId);
    await _assertResourcesAvailable(client, resourceIds, industryId);
    await _assertMaterialsAvailable(client, wo.bom_id, wo.quantity, industryId);

    await _setMachinesStatus(client, machineIds, 'running');
    await _setResourcesStatus(client, resourceIds, 'running');
    await client.query(`UPDATE mfg_work_orders SET status='in_progress', updated_at=NOW() WHERE id=$1`, [woId]);

    await client.query('COMMIT');
    return { success: true, machine_ids: machineIds, resource_ids: resourceIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// NEW
// Finish a production run — flips machines/resources back to "idle"
// payload may carry an operator-confirmed actual quantity/scrap from the
// "Confirm Production Completion" modal; falls back to the WO's planned
// quantity if not supplied, so any older caller still behaves as before.
const finishProductionRun = async (industryId, woId, payload = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const woRes = await client.query('SELECT * FROM mfg_work_orders WHERE id=$1 AND industry_id=$2 FOR UPDATE', [woId, industryId]);
    const wo = woRes.rows[0];
    if (!wo) throw new Error('Work order not found');
    if (!wo.product_id) throw new Error('This work order has no linked product — cannot record production.');

    const confirmedQuantity = payload.quantity !== undefined && payload.quantity !== null && payload.quantity !== ''
      ? parseFloat(payload.quantity)
      : parseFloat(wo.quantity);
    const quantity = confirmedQuantity || 0;
    if (quantity <= 0) throw new Error('Produced quantity must be greater than 0.');

    const scrapQty = payload.scrap_qty !== undefined && payload.scrap_qty !== null && payload.scrap_qty !== ''
      ? Math.max(0, parseFloat(payload.scrap_qty) || 0)
      : 0;
    const totalAttempted = quantity + scrapQty; 

    const prodRes = await client.query(
      'SELECT id, name, current_stock, purchase_price_exc_tax FROM products WHERE id=$1 AND industry_id=$2 FOR UPDATE',
      [wo.product_id, industryId]
    );
    const finishedProduct = prodRes.rows[0];
    if (!finishedProduct) throw new Error('Linked product not found.');

   let totalCost = 0;
    let componentsUsed = [];
    let recipeLabel = null;
    const location = wo.location || null;

    if (wo.bom_id) {
      // Component consumption is scaled to good + scrap (totalAttempted),
      // matching the same convention used in createProduction/updateProduction.
      const applied = await _applyBomConsumption(client, wo.bom_id, totalAttempted, location, industryId);
      totalCost = applied.totalCost;
      componentsUsed = applied.componentsUsed;
      const bomRow = await client.query('SELECT product_code FROM mfg_bom WHERE id=$1 AND industry_id=$2', [wo.bom_id, industryId]);
      recipeLabel = bomRow.rows[0]?.product_code || `BOM-${wo.bom_id}`;
    }
    const oldStock = parseFloat(finishedProduct.current_stock || 0);
    const newFinishedStock = oldStock + quantity;
    const unitCost = quantity > 0 ? totalCost / quantity : 0;
    const oldCost = parseFloat(finishedProduct.purchase_price_exc_tax) || 0;
    const newAvgCost = unitCost > 0
      ? (newFinishedStock > 0 ? (oldStock * oldCost + quantity * unitCost) / newFinishedStock : unitCost)
      : oldCost;

    await stockLocationService.adjustStockAtLocation(client, wo.product_id, location, quantity);
    await client.query(
      'UPDATE products SET purchase_price_exc_tax=$1, updated_at=NOW() WHERE id=$2',
      [newAvgCost, wo.product_id]
    );

 const refNo = await nextRef(client, 'mfg_production', 'PRD', industryId);
    const insertRes = await client.query(
      `INSERT INTO mfg_production
       (industry_id, ref_no, location, product, product_id, quantity, scrap_qty, scrap_reason, total_cost, date, recipe_used, bom_id, notes, wo_id, run_status, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE,$10,$11,$12,$13,'completed',NOW(),NOW()) RETURNING *`,
      [industryId, refNo, location, finishedProduct.name, wo.product_id, quantity, scrapQty, scrapQty > 0 ? (payload.scrap_reason || null) : null, totalCost, recipeLabel, wo.bom_id || null, payload.notes || `Confirmed on finishing ${wo.wo_number}`, woId]
    );

    const machineIds  = await _getWoMachineIds(client, woId);
    const resourceIds = await _getWoResourceIds(client, woId);
    await _setMachinesStatus(client, machineIds, 'idle');
    await _setResourcesStatus(client, resourceIds, 'idle');

    await client.query(
      `UPDATE mfg_work_orders SET status='completed', progress=100, updated_at=NOW() WHERE id=$1`,
      [woId]
    );

await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Finished ${wo.wo_number}`, detail: `${finishedProduct.name} × ${quantity}` });

    // Component stock just went down — check each deducted component,
    // non-blocking, same pattern as sellService.js.
    for (const c of componentsUsed) {
      notificationEngine.checkAndAlertLowStock(c.product_id).catch(err =>
        console.error('[Manufacturing] low stock alert check failed:', err.message)
      );
    }

    return { message: 'Production finished — stock updated.', production: insertRes.rows[0], components_used: componentsUsed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
// ═══════════════════════════════════════════════════════════════════
// AUTO-FINISH — sweeps in_progress Work Orders whose end_date has passed
// and finishes them automatically, at the planned quantity with 0 scrap.
// Manual "Finish Production" still works normally at any time before this
// runs — whichever happens first wins, since finishProductionRun flips
// status to 'completed' and this only ever targets status='in_progress'.
// This is a system-level sweep with no request context, so it runs across
// every industry — each row carries its own industry_id, which is passed
// straight into finishProductionRun so nothing crosses workspace boundaries.
// ═══════════════════════════════════════════════════════════════════
const autoFinishOverdueWorkOrders = async () => {
  const { rows } = await pool.query(
    `SELECT id, wo_number, industry_id FROM mfg_work_orders
     WHERE status = 'in_progress' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`
  );
  for (const wo of rows) {
    try {
      await finishProductionRun(wo.industry_id, wo.id, { notes: `Auto-finished — due date passed (${wo.wo_number})` });
      console.log(`[AutoFinish] ${wo.wo_number} auto-completed (end_date passed).`);
    } catch (err) {
      // One bad WO (e.g. insufficient stock) must not block the rest of the sweep
      console.error(`[AutoFinish] Failed to auto-finish ${wo.wo_number}:`, err.message);
    }
  }
  return { checked: rows.length };
};

// ═══════════════════════════════════════════════════════════════════
// PRODUCTION RUNS — the stock-moving event
// ═══════════════════════════════════════════════════════════════════

// Deducts components for a BOM scaled to `quantity`, at a specific stock
// location, returns { totalCost, componentsUsed }
// NEW
const _applyBomConsumption = async (client, bomId, quantity, location, industryId) => {
  const bomRes = await client.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bomId, industryId]);
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
        'SELECT id, name FROM products WHERE id=$1 AND industry_id=$2 FOR UPDATE',
        [item.product_id, industryId]
      );
      const comp = compRes.rows[0];
      if (!comp) throw new Error(`Linked component product not found: ${item.item_name || 'unknown'}`);

      await stockLocationService.adjustStockAtLocation(client, item.product_id, location, -needed);
      componentsUsed.push({ product_id: item.product_id, name: comp.name, deducted: needed });
    }
  }

  return { totalCost, componentsUsed };
};

const _reverseProductionStock = async (client, prodRow, industryId) => {
const location = prodRow.location || await stockLocationService.getDefaultLocationName(client);
  if (prodRow.product_id) {
    await stockLocationService.adjustStockAtLocation(client, prodRow.product_id, location, -parseFloat(prodRow.quantity), { allowNegative: true });
  }
  if (prodRow.bom_id) {
    const bomRes = await client.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [prodRow.bom_id, industryId]);
    const bom = bomRes.rows[0];
    if (bom) {
      const itemsRes = await client.query('SELECT * FROM mfg_bom_items WHERE bom_id=$1', [prodRow.bom_id]);
      const totalAttempted = parseFloat(prodRow.quantity) + (parseFloat(prodRow.scrap_qty) || 0);
      const scale = totalAttempted / (parseFloat(bom.quantity) || 1);
      for (const item of itemsRes.rows) {
        if (item.product_id) {
          const needed = (parseFloat(item.quantity) || 0) * scale;
          await stockLocationService.adjustStockAtLocation(client, item.product_id, location, needed, { allowNegative: true });
        }
      }
    }
  }
};
const fetchProduction = (industryId) =>
  pool.query('SELECT * FROM mfg_production WHERE industry_id=$1 ORDER BY date DESC, created_at DESC', [industryId]).then(r => r.rows);

const _syncWorkOrderProgress = async (client, productId, industryId) => {
  if (!productId) return;
  const woRes = await client.query(
    `SELECT * FROM mfg_work_orders WHERE product_id=$1 AND industry_id=$2 AND status != 'completed' ORDER BY created_at ASC LIMIT 1`,
    [productId, industryId]
  );
  const wo = woRes.rows[0];
  if (!wo) return;

  const producedRes = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS total FROM mfg_production WHERE product_id=$1 AND industry_id=$2`,
    [productId, industryId]
  );
  const produced = parseFloat(producedRes.rows[0].total) || 0;
  const target = parseFloat(wo.quantity) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;
  const newStatus = pct >= 100 ? 'completed' : (pct > 0 ? 'in_progress' : wo.status);

  await client.query(
    'UPDATE mfg_work_orders SET progress=$1, status=$2, updated_at=NOW() WHERE id=$3',
    [pct, newStatus, wo.id]
  );
};

const createProduction = async (industryId, data) => {
  const { ref_no, location, product_id, quantity, scrap_qty, scrap_reason, date, bom_id, notes } = data;
  if (!product_id) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');
  const scrapQty = parseFloat(scrap_qty) || 0;
  if (scrapQty < 0) throw new Error('Scrap quantity cannot be negative');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prodRes = await client.query(
      'SELECT id, name, current_stock, purchase_price_exc_tax FROM products WHERE id=$1 AND industry_id=$2 FOR UPDATE',
      [product_id, industryId]
    );
    const finishedProduct = prodRes.rows[0];
    if (!finishedProduct) throw new Error('Selected product not found');

    if (bom_id) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    let totalCost = 0;
    let componentsUsed = [];
    let recipeLabel = null;

    const totalAttempted = parseFloat(quantity) + scrapQty;

    if (bom_id) {
      const applied = await _applyBomConsumption(client, bom_id, totalAttempted, location, industryId);
      totalCost = applied.totalCost;
      componentsUsed = applied.componentsUsed;
      const bomRow = await client.query('SELECT product_code FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      recipeLabel = bomRow.rows[0]?.product_code || `BOM-${bom_id}`;
    } else if (data.total_cost) {
      totalCost = parseFloat(data.total_cost) || 0;
    }

    const oldStock = parseFloat(finishedProduct.current_stock || 0);
    const newFinishedStock = oldStock + parseFloat(quantity);

    const unitCost = parseFloat(quantity) > 0 ? totalCost / parseFloat(quantity) : 0;
    const oldCost = parseFloat(finishedProduct.purchase_price_exc_tax) || 0;
    const newAvgCost = unitCost > 0
      ? (newFinishedStock > 0 ? (oldStock * oldCost + parseFloat(quantity) * unitCost) / newFinishedStock : unitCost)
      : oldCost;

    await stockLocationService.adjustStockAtLocation(client, product_id, location, parseFloat(quantity));
    await client.query(
      'UPDATE products SET purchase_price_exc_tax=$1, updated_at=NOW() WHERE id=$2',
      [newAvgCost, product_id]
    );

  const refNo = ref_no || await nextRef(client, 'mfg_production', 'PRD', industryId);
    const woId = data.wo_id || null;

    const insertRes = await client.query(
      `INSERT INTO mfg_production
       (industry_id, ref_no, location, product, product_id, quantity, scrap_qty, scrap_reason, total_cost, date, recipe_used, bom_id, notes, wo_id, run_status, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',NOW(),NOW()) RETURNING *`,
      [industryId, refNo, location || null, finishedProduct.name, product_id, quantity, scrapQty, scrapQty > 0 ? (scrap_reason || null) : null, totalCost, date, recipeLabel, bom_id || null, notes || null, woId]
    );

    await _syncWorkOrderProgress(client, product_id, industryId);

    if (woId) {
      const machineIds  = await _getWoMachineIds(client, woId);
      const resourceIds = await _getWoResourceIds(client, woId);
      await _setMachinesStatus(client, machineIds, 'idle');
      await _setResourcesStatus(client, resourceIds, 'idle');
    }
await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Recorded Production ${insertRes.rows[0].ref_no}`, detail: `${finishedProduct.name} × ${quantity}` });

    for (const c of componentsUsed) {
      notificationEngine.checkAndAlertLowStock(c.product_id).catch(err =>
        console.error('[Manufacturing] low stock alert check failed:', err.message)
      );
    }

    return { ...insertRes.rows[0], components_used: componentsUsed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateProduction = async (industryId, id, data) => {
  const { ref_no, location, product_id, quantity, scrap_qty, scrap_reason, date, bom_id, notes } = data;
  if (!product_id) throw new Error('Product is required');
  if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0');
  const scrapQty = parseFloat(scrap_qty) || 0;
  if (scrapQty < 0) throw new Error('Scrap quantity cannot be negative');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingRes = await client.query('SELECT * FROM mfg_production WHERE id=$1 AND industry_id=$2', [id, industryId]);
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Production record not found');

    await _reverseProductionStock(client, existing, industryId);

    const prodRes = await client.query(
      'SELECT id, name, current_stock, purchase_price_exc_tax FROM products WHERE id=$1 AND industry_id=$2 FOR UPDATE',
      [product_id, industryId]
    );
    const finishedProduct = prodRes.rows[0];
    if (!finishedProduct) throw new Error('Selected product not found');

    if (bom_id) {
      const bomCheck = await client.query('SELECT id FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      if (!bomCheck.rows[0]) throw new Error('Selected BOM does not belong to the active workspace');
    }

    let totalCost = 0;
    let recipeLabel = null;
    const totalAttempted = parseFloat(quantity) + scrapQty;
    if (bom_id) {
      const applied = await _applyBomConsumption(client, bom_id, totalAttempted, location, industryId);
      totalCost = applied.totalCost;
      const bomRow = await client.query('SELECT product_code FROM mfg_bom WHERE id=$1 AND industry_id=$2', [bom_id, industryId]);
      recipeLabel = bomRow.rows[0]?.product_code || `BOM-${bom_id}`;
    } else if (data.total_cost) {
      totalCost = parseFloat(data.total_cost) || 0;
    }

    const oldStock = parseFloat(finishedProduct.current_stock || 0);
    const newFinishedStock = oldStock + parseFloat(quantity);
    const unitCost = parseFloat(quantity) > 0 ? totalCost / parseFloat(quantity) : 0;
    const oldCost = parseFloat(finishedProduct.purchase_price_exc_tax) || 0;
    const newAvgCost = unitCost > 0
      ? (newFinishedStock > 0 ? (oldStock * oldCost + parseFloat(quantity) * unitCost) / newFinishedStock : unitCost)
      : oldCost;

    await stockLocationService.adjustStockAtLocation(client, product_id, location, parseFloat(quantity));
    await client.query(
      'UPDATE products SET purchase_price_exc_tax=$1, updated_at=NOW() WHERE id=$2',
      [newAvgCost, product_id]
    );

    const updateRes = await client.query(
      `UPDATE mfg_production SET ref_no=$1, location=$2, product=$3, product_id=$4, quantity=$5,
       scrap_qty=$6, scrap_reason=$7, total_cost=$8, date=$9, recipe_used=$10, bom_id=$11, notes=$12, updated_at=NOW()
       WHERE id=$13 AND industry_id=$14 RETURNING *`,
      [ref_no || existing.ref_no, location || null, finishedProduct.name, product_id, quantity, scrapQty, scrapQty > 0 ? (scrap_reason || null) : null, totalCost, date, recipeLabel, bom_id || null, notes || null, id, industryId]
    );

    await _syncWorkOrderProgress(client, product_id, industryId);
    if (existing.product_id && String(existing.product_id) !== String(product_id)) {
      await _syncWorkOrderProgress(client, existing.product_id, industryId);
    }

    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Updated Production ${updateRes.rows[0].ref_no}`, detail: `${finishedProduct.name} × ${quantity}` });
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteProduction = async (industryId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query('SELECT * FROM mfg_production WHERE id=$1 AND industry_id=$2', [id, industryId]);
    const existing = existingRes.rows[0];
    if (!existing) throw new Error('Production record not found');

    await _reverseProductionStock(client, existing, industryId);
    await client.query('DELETE FROM mfg_production WHERE id=$1', [id]);

    if (existing.product_id) {
      const woRes = await client.query(
        `SELECT * FROM mfg_work_orders WHERE product_id=$1 AND industry_id=$2 AND status != 'planned' ORDER BY created_at ASC LIMIT 1`,
        [existing.product_id, industryId]
      );
      const wo = woRes.rows[0];
      if (wo) {
        const producedRes = await client.query(
          `SELECT COALESCE(SUM(quantity),0) AS total FROM mfg_production WHERE product_id=$1 AND industry_id=$2`,
          [existing.product_id, industryId]
        );
        const produced = parseFloat(producedRes.rows[0].total) || 0;
        const target = parseFloat(wo.quantity) || 0;
        const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;
        const newStatus = pct >= 100 ? 'completed' : (pct > 0 ? 'in_progress' : 'planned');
        await client.query('UPDATE mfg_work_orders SET progress=$1, status=$2, updated_at=NOW() WHERE id=$3', [pct, newStatus, wo.id]);
      }
    }
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Deleted Production ${existing.ref_no}` });
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
// NEW
const fetchResources = (industryId) =>
  pool.query('SELECT * FROM mfg_resources WHERE industry_id=$1 ORDER BY name ASC', [industryId]).then(r => r.rows);

const createResource = async (industryId, data) => {
  const { name, type, capacity, shift, operator, status, notes } = data;
  if (!name?.trim()) throw new Error('Resource name is required');
  const r = await pool.query(
    `INSERT INTO mfg_resources (industry_id, name, type, capacity, shift, operator, status, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
    [industryId, name, type || 'Machine', capacity || null, shift || 'Morning', operator || null, status || 'idle', notes || null]
  );
  logActivity({ module: 'Manufacturing', action: `Added Resource ${r.rows[0].name}`, detail: `Type: ${type || 'Machine'}` });
  return r.rows[0];
};

const updateResource = async (industryId, id, data) => {
  const { name, type, capacity, shift, operator, status, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_resources SET name=$1, type=$2, capacity=$3, shift=$4, operator=$5, status=$6, notes=$7, updated_at=NOW()
     WHERE id=$8 AND industry_id=$9 RETURNING *`,
    [name, type, capacity, shift, operator, status, notes, id, industryId]
  );
  if (!r.rows[0]) throw new Error('Resource not found');
  logActivity({ module: 'Manufacturing', action: `Updated Resource ${r.rows[0].name}`, detail: `Status: ${r.rows[0].status}` });
  return r.rows[0];
};

const deleteResource = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_resources WHERE id=$1 AND industry_id=$2 RETURNING id, name', [id, industryId]);
  if (!r.rows[0]) throw new Error('Resource not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Resource ${r.rows[0].name}` });
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// MACHINES
// ═══════════════════════════════════════════════════════════════════
const fetchMachines = (industryId) =>
  pool.query('SELECT * FROM mfg_machines WHERE industry_id=$1 ORDER BY name ASC', [industryId]).then(r => r.rows);

const createMachine = async (industryId, data) => {
  const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = data;
  if (!name?.trim()) throw new Error('Machine name is required');
  const r = await pool.query(
    `INSERT INTO mfg_machines (industry_id, name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
    [industryId, name, machine_code || null, type || null, location || null, manufacturer || null, model || null, purchase_date || null, status || 'active', last_maintenance || null, next_maintenance || null, notes || null]
  );
  logActivity({ module: 'Manufacturing', action: `Added Machine ${r.rows[0].name}`, detail: `Code: ${machine_code || ''}` });
  return r.rows[0];
};

const updateMachine = async (industryId, id, data) => {
  const { name, machine_code, type, location, manufacturer, model, purchase_date, status, last_maintenance, next_maintenance, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_machines SET name=$1, machine_code=$2, type=$3, location=$4, manufacturer=$5, model=$6,
     purchase_date=$7, status=$8, last_maintenance=$9, next_maintenance=$10, notes=$11, updated_at=NOW()
     WHERE id=$12 AND industry_id=$13 RETURNING *`,
    [name, machine_code, type, location, manufacturer, model, purchase_date || null, status, last_maintenance || null, next_maintenance || null, notes, id, industryId]
  );
  if (!r.rows[0]) throw new Error('Machine not found');
  logActivity({ module: 'Manufacturing', action: `Updated Machine ${r.rows[0].name}`, detail: `Status: ${r.rows[0].status}` });
  return r.rows[0];
};
const deleteMachine = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_machines WHERE id=$1 AND industry_id=$2 RETURNING id, name', [id, industryId]);
  if (!r.rows[0]) throw new Error('Machine not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Machine ${r.rows[0].name}` });
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// MACHINE DETAIL — full profile (specs + linked history in one call)
// ═══════════════════════════════════════════════════════════════════
const fetchMachineDetail = async (industryId, id) => {
  const machineRes = await pool.query('SELECT * FROM mfg_machines WHERE id=$1 AND industry_id=$2', [id, industryId]);
  const machine = machineRes.rows[0];
  if (!machine) return null;

  const [maintenance, logs, documents, qualityChecks] = await Promise.all([
    pool.query('SELECT * FROM mfg_maintenance WHERE machine_id=$1 AND industry_id=$2 ORDER BY scheduled_date DESC', [id, industryId]),
    pool.query('SELECT * FROM mfg_machine_logs WHERE machine_id=$1 AND industry_id=$2 ORDER BY start_time DESC LIMIT 200', [id, industryId]),
    pool.query('SELECT * FROM mfg_machine_documents WHERE machine_id=$1 AND industry_id=$2 ORDER BY uploaded_at DESC', [id, industryId]),
    pool.query(`SELECT * FROM mfg_quality_checks WHERE industry_id=$2 AND product IN (
      SELECT DISTINCT product FROM mfg_production WHERE industry_id=$2 AND ref_no IN (
        SELECT ref_no FROM mfg_machine_logs ml JOIN mfg_production p ON p.ref_no = p.ref_no WHERE ml.machine_id=$1
      )
    ) ORDER BY inspection_date DESC LIMIT 20`, [id, industryId]).catch(() => ({ rows: [] })),
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
const fetchMachineLogs = (industryId, machineId) =>
  pool.query('SELECT * FROM mfg_machine_logs WHERE machine_id=$1 AND industry_id=$2 ORDER BY start_time DESC', [machineId, industryId]).then(r => r.rows);

const createMachineLog = async (industryId, machineId, data) => {
  const { event_type, reason, start_time, end_time, units_produced, units_rejected, notes } = data;
  if (!event_type) throw new Error('Event type is required');
  if (!start_time) throw new Error('Start time is required');

  const machineCheck = await pool.query('SELECT id FROM mfg_machines WHERE id=$1 AND industry_id=$2', [machineId, industryId]);
  if (!machineCheck.rows[0]) throw new Error('Machine not found');

  const r = await pool.query(
    `INSERT INTO mfg_machine_logs
     (industry_id, machine_id, event_type, reason, start_time, end_time, units_produced, units_rejected, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
    [industryId, machineId, event_type, reason || null, start_time, end_time || null, units_produced || 0, units_rejected || 0, notes || null]
  );

  // Auto-sync machine status for live/downtime/maintenance events with no end_time yet
  if (!end_time) {
    const statusMap = { running: 'running', idle: 'idle', downtime: 'maintenance', maintenance: 'maintenance' };
    if (statusMap[event_type]) {
      await pool.query('UPDATE mfg_machines SET status=$1, updated_at=NOW() WHERE id=$2 AND industry_id=$3', [statusMap[event_type], machineId, industryId]);
    }
  }

  logActivity({ module: 'Manufacturing', action: `Logged ${event_type} event`, detail: `Machine ID: ${machineId}` });
  return r.rows[0];
};

const updateMachineLog = async (industryId, id, data) => {
  const { event_type, reason, start_time, end_time, units_produced, units_rejected, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_machine_logs SET event_type=$1, reason=$2, start_time=$3, end_time=$4,
     units_produced=$5, units_rejected=$6, notes=$7, updated_at=NOW() WHERE id=$8 AND industry_id=$9 RETURNING *`,
    [event_type, reason || null, start_time, end_time || null, units_produced || 0, units_rejected || 0, notes || null, id, industryId]
  );
  if (!r.rows[0]) throw new Error('Machine log not found');
  return r.rows[0];
};

const deleteMachineLog = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_machine_logs WHERE id=$1 AND industry_id=$2 RETURNING id', [id, industryId]);
  if (!r.rows[0]) throw new Error('Machine log not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Machine Log #${id}` });
  return { success: true };
};

// ─── Machine Documents ───
const fetchMachineDocuments = (industryId, machineId) =>
  pool.query('SELECT * FROM mfg_machine_documents WHERE machine_id=$1 AND industry_id=$2 ORDER BY uploaded_at DESC', [machineId, industryId]).then(r => r.rows);

const createMachineDocument = async (industryId, machineId, data) => {
  const { doc_name, doc_url, doc_type } = data;
  if (!doc_name?.trim()) throw new Error('Document name is required');
  if (!doc_url?.trim()) throw new Error('Document URL is required');
  const machineCheck = await pool.query('SELECT id FROM mfg_machines WHERE id=$1 AND industry_id=$2', [machineId, industryId]);
  if (!machineCheck.rows[0]) throw new Error('Machine not found');
  const r = await pool.query(
    `INSERT INTO mfg_machine_documents (industry_id, machine_id, doc_name, doc_url, doc_type, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
    [industryId, machineId, doc_name, doc_url, doc_type || 'manual']
  );
  logActivity({ module: 'Manufacturing', action: `Uploaded Document ${doc_name}`, detail: `Machine ID: ${machineId}` });
  return r.rows[0];
};

const deleteMachineDocument = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_machine_documents WHERE id=$1 AND industry_id=$2 RETURNING id, doc_name', [id, industryId]);
  if (!r.rows[0]) throw new Error('Document not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Document ${r.rows[0].doc_name}` });
  return { success: true };
};

// ═══════════════════════════════════════════════════════════════════
// OEE / UTILIZATION DASHBOARD
// ═══════════════════════════════════════════════════════════════════
const fetchMachineOEE = async (industryId, machineId, from, to) => {
  const fromDate = from || '2000-01-01';
  const toDate   = to   || '2099-12-31';

  const machineRes = await pool.query('SELECT * FROM mfg_machines WHERE id=$1 AND industry_id=$2', [machineId, industryId]);
  const machine = machineRes.rows[0];
  if (!machine) throw new Error('Machine not found');

  const logsRes = await pool.query(
    `SELECT * FROM mfg_machine_logs
     WHERE machine_id=$1 AND industry_id=$4 AND start_time BETWEEN $2 AND $3 AND end_time IS NOT NULL`,
    [machineId, fromDate, toDate, industryId]
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
const fetchFleetOEE = async (industryId, from, to) => {
  const machines = await pool.query('SELECT id, name, status FROM mfg_machines WHERE industry_id=$1 ORDER BY name ASC', [industryId]);
  const results = await Promise.all(
    machines.rows.map(async m => {
      try { return await fetchMachineOEE(industryId, m.id, from, to); }
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
// NEW
const fetchQualityChecks = (industryId) =>
  pool.query('SELECT * FROM mfg_quality_checks WHERE industry_id=$1 ORDER BY inspection_date DESC', [industryId]).then(r => r.rows);

const createQualityCheck = async (industryId, data) => {
  const { ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = data;
  if (!product?.trim()) throw new Error('Product is required');
  if (!quantity_checked) throw new Error('Quantity checked is required');

  // Cross-industry guard: product_id (if given) must belong to this workspace
  if (product_id) {
    const prodCheck = await pool.query('SELECT id FROM products WHERE id=$1 AND industry_id=$2', [product_id, industryId]);
    if (!prodCheck.rows[0]) throw new Error('Product not found in this industry workspace');
  }

  const refNo = ref_no || await nextRef(pool, 'mfg_quality_checks', 'QC', industryId);
  const r = await pool.query(
    `INSERT INTO mfg_quality_checks (industry_id, ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
    [industryId, refNo, product, product_id || null, batch_no || null, inspected_by || null, inspection_date, quantity_checked, quantity_passed || 0, quantity_failed || 0, status || 'pending', remarks || null]
  );
  logActivity({ module: 'Manufacturing', action: `Created Quality Check ${r.rows[0].ref_no}`, detail: `${product} — ${status || 'pending'}` });
  return r.rows[0];
};

const updateQualityCheck = async (industryId, id, data) => {
  const { ref_no, product, product_id, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks } = data;
  const r = await pool.query(
    `UPDATE mfg_quality_checks SET ref_no=$1, product=$2, product_id=$3, batch_no=$4, inspected_by=$5, inspection_date=$6,
     quantity_checked=$7, quantity_passed=$8, quantity_failed=$9, status=$10, remarks=$11, updated_at=NOW()
     WHERE id=$12 AND industry_id=$13 RETURNING *`,
    [ref_no, product, product_id || null, batch_no, inspected_by, inspection_date, quantity_checked, quantity_passed, quantity_failed, status, remarks, id, industryId]
  );
  if (!r.rows[0]) throw new Error('Quality check not found');
  logActivity({ module: 'Manufacturing', action: `Updated Quality Check ${r.rows[0].ref_no}`, detail: `Status: ${r.rows[0].status}` });
  return r.rows[0];
};

const deleteQualityCheck = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_quality_checks WHERE id=$1 AND industry_id=$2 RETURNING id, ref_no', [id, industryId]);
  if (!r.rows[0]) throw new Error('Quality check not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Quality Check ${r.rows[0].ref_no}` });
  return { success: true };
};
// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════
// NEW
const fetchMaintenance = (industryId) =>
  pool.query('SELECT * FROM mfg_maintenance WHERE industry_id=$1 ORDER BY scheduled_date DESC', [industryId]).then(r => r.rows);

const createMaintenance = async (industryId, data) => {
  const { ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = data;
  if (!machine_name?.trim()) throw new Error('Machine name is required');
  if (!scheduled_date) throw new Error('Scheduled date is required');
  const refNo = ref_no || await nextRef(pool, 'mfg_maintenance', 'MNT', industryId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cross-industry guard: machine_id (if given) must belong to this workspace
    if (machine_id) {
      const machineCheck = await client.query('SELECT id FROM mfg_machines WHERE id=$1 AND industry_id=$2', [machine_id, industryId]);
      if (!machineCheck.rows[0]) throw new Error('Machine not found in this industry workspace');
    }

    const r = await client.query(
      `INSERT INTO mfg_maintenance (industry_id, ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
      [industryId, refNo, machine_name, machine_id || null, maintenance_type || 'Preventive', technician || null, scheduled_date, completed_date || null, status || 'scheduled', cost || null, description || null, notes || null]
    );
    if (machine_id && (status === 'in_progress' || !status || status === 'scheduled')) {
      await client.query(`UPDATE mfg_machines SET status='maintenance', updated_at=NOW() WHERE id=$1 AND industry_id=$2`, [machine_id, industryId]);
    }
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Scheduled Maintenance ${r.rows[0].ref_no}`, detail: `${machine_name} — ${maintenance_type || 'Preventive'}` });
    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateMaintenance = async (industryId, id, data) => {
  const { ref_no, machine_name, machine_id, maintenance_type, technician, scheduled_date, completed_date, status, cost, description, notes } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (machine_id) {
      const machineCheck = await client.query('SELECT id FROM mfg_machines WHERE id=$1 AND industry_id=$2', [machine_id, industryId]);
      if (!machineCheck.rows[0]) throw new Error('Machine not found in this industry workspace');
    }

    const r = await client.query(
      `UPDATE mfg_maintenance SET ref_no=$1, machine_name=$2, machine_id=$3, maintenance_type=$4, technician=$5,
       scheduled_date=$6, completed_date=$7, status=$8, cost=$9, description=$10, notes=$11, updated_at=NOW()
       WHERE id=$12 AND industry_id=$13 RETURNING *`,
      [ref_no, machine_name, machine_id || null, maintenance_type, technician, scheduled_date, completed_date || null, status, cost || null, description, notes, id, industryId]
    );
    if (!r.rows[0]) throw new Error('Maintenance record not found');
    if (machine_id) {
      const newMachineStatus = (status === 'completed' || status === 'cancelled') ? 'idle' : 'maintenance';
      await client.query(`UPDATE mfg_machines SET status=$1, updated_at=NOW() WHERE id=$2 AND industry_id=$3`, [newMachineStatus, machine_id, industryId]);
    }
    await client.query('COMMIT');
    logActivity({ module: 'Manufacturing', action: `Updated Maintenance ${r.rows[0].ref_no}`, detail: `Status: ${r.rows[0].status}` });
    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteMaintenance = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_maintenance WHERE id=$1 AND industry_id=$2 RETURNING id, ref_no', [id, industryId]);
  if (!r.rows[0]) throw new Error('Maintenance record not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Maintenance ${r.rows[0].ref_no}` });
  return { success: true };
};
// ═══════════════════════════════════════════════════════════════════
// SCHEDULE
// ═══════════════════════════════════════════════════════════════════
const fetchSchedule = (industryId) =>
  pool.query('SELECT * FROM mfg_schedule WHERE industry_id=$1 ORDER BY start_date DESC, created_at DESC', [industryId]).then(r => r.rows);

const createSchedule = async (industryId, data) => {
  const { ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
          assigned_team, location, machine_name, priority, status, recurrence, notes } = data;
  if (!title?.trim()) throw new Error('Title is required');
  if (!start_date) throw new Error('Start date is required');
  const refNo = ref_no || await nextRef(pool, 'mfg_schedule', 'SCH', industryId);
  const r = await pool.query(
    `INSERT INTO mfg_schedule
     (industry_id, ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
      assigned_team, location, machine_name, priority, status, recurrence, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()) RETURNING *`,
    [industryId, refNo, title, event_type || 'Production Run', product_name || null, start_date, end_date || null,
     start_time || null, end_time || null, assigned_team || null, location || null, machine_name || null,
     priority || 'medium', status || 'scheduled', recurrence || 'none', notes || null]
  );
  logActivity({ module: 'Manufacturing', action: `Created Schedule Entry ${r.rows[0].ref_no}`, detail: title });
  return r.rows[0];
};

const updateSchedule = async (industryId, id, data) => {
  const { ref_no, title, event_type, product_name, start_date, end_date, start_time, end_time,
          assigned_team, location, machine_name, priority, status, recurrence, notes } = data;
  const r = await pool.query(
    `UPDATE mfg_schedule SET ref_no=$1, title=$2, event_type=$3, product_name=$4, start_date=$5,
     end_date=$6, start_time=$7, end_time=$8, assigned_team=$9, location=$10, machine_name=$11,
     priority=$12, status=$13, recurrence=$14, notes=$15, updated_at=NOW() WHERE id=$16 AND industry_id=$17 RETURNING *`,
    [ref_no, title, event_type, product_name, start_date, end_date || null, start_time || null,
     end_time || null, assigned_team, location, machine_name, priority, status, recurrence, notes, id, industryId]
  );
  if (!r.rows[0]) throw new Error('Schedule entry not found');
  logActivity({ module: 'Manufacturing', action: `Updated Schedule Entry ${r.rows[0].ref_no}`, detail: r.rows[0].title });
  return r.rows[0];
};

const deleteSchedule = async (industryId, id) => {
  const r = await pool.query('DELETE FROM mfg_schedule WHERE id=$1 AND industry_id=$2 RETURNING id, ref_no', [id, industryId]);
  if (!r.rows[0]) throw new Error('Schedule entry not found');
  logActivity({ module: 'Manufacturing', action: `Deleted Schedule Entry ${r.rows[0].ref_no}` });
  return { success: true };
};  

// ═══════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════
// NEW
const fetchReportsSummary = async (industryId, from, to) => {
  const fromDate = from || '2000-01-01';
  const toDate   = to   || '2099-12-31';

  const [prodCount, prodQty, prodCost, woCompleted, topProducts, qcSummary] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM mfg_production WHERE industry_id=$1 AND date BETWEEN $2 AND $3', [industryId, fromDate, toDate]),
    pool.query('SELECT COALESCE(SUM(quantity),0) AS total FROM mfg_production WHERE industry_id=$1 AND date BETWEEN $2 AND $3', [industryId, fromDate, toDate]),
    pool.query('SELECT COALESCE(SUM(total_cost),0) AS total FROM mfg_production WHERE industry_id=$1 AND date BETWEEN $2 AND $3', [industryId, fromDate, toDate]),
    pool.query("SELECT COUNT(*) FROM mfg_work_orders WHERE industry_id=$1 AND status='completed' AND end_date BETWEEN $2 AND $3", [industryId, fromDate, toDate]),
    pool.query(
      `SELECT product, SUM(quantity) AS total_qty, SUM(total_cost) AS total_cost, COUNT(*) AS count
       FROM mfg_production WHERE industry_id=$1 AND date BETWEEN $2 AND $3
       GROUP BY product ORDER BY total_qty DESC LIMIT 10`,
      [industryId, fromDate, toDate]
    ),
    pool.query(
      `SELECT COALESCE(SUM(quantity_checked),0) AS total_checked,
              COALESCE(SUM(quantity_passed),0)  AS total_passed,
              COALESCE(SUM(quantity_failed),0)  AS total_failed
       FROM mfg_quality_checks WHERE industry_id=$1 AND inspection_date BETWEEN $2 AND $3`,
      [industryId, fromDate, toDate]
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

// NEW (complete)
const fetchCostVariance = async (industryId, from, to) => {
  const fromDate = from || '2000-01-01';
  const toDate   = to   || '2099-12-31';

  const runsRes = await pool.query(
    `SELECT p.id, p.ref_no, p.product, p.product_id, p.quantity, p.total_cost, p.bom_id, p.date
     FROM mfg_production p
     WHERE p.industry_id=$1 AND p.bom_id IS NOT NULL AND p.date BETWEEN $2 AND $3
     ORDER BY p.date DESC`,
    [industryId, fromDate, toDate]
  );

  const rows = [];
  let totalActual = 0, totalStandard = 0;

  for (const run of runsRes.rows) {
    const bomRes = await pool.query('SELECT * FROM mfg_bom WHERE id=$1 AND industry_id=$2', [run.bom_id, industryId]);
    const bom = bomRes.rows[0];
    if (!bom) continue;

    const itemsRes = await pool.query(
      `SELECT bi.* FROM mfg_bom_items bi JOIN mfg_bom b ON b.id = bi.bom_id WHERE bi.bom_id=$1 AND b.industry_id=$2`,
      [run.bom_id, industryId]
    );
    const scale = parseFloat(run.quantity) / (parseFloat(bom.quantity) || 1);
    const standardCost = itemsRes.rows.reduce(
      (sum, item) => sum + (parseFloat(item.quantity) || 0) * scale * (parseFloat(item.cost) || 0),
      0
    );
    const actualCost = parseFloat(run.total_cost) || 0;
    const variance = actualCost - standardCost;

    totalActual += actualCost;
    totalStandard += standardCost;

    rows.push({
      ref_no: run.ref_no,
      product: run.product,
      date: run.date,
      quantity: run.quantity,
      standard_cost: Math.round(standardCost * 100) / 100,
      actual_cost: Math.round(actualCost * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      variance_pct: standardCost > 0 ? Math.round((variance / standardCost) * 10000) / 100 : 0,
      status: variance > 0.01 ? 'unfavorable' : (variance < -0.01 ? 'favorable' : 'on_standard'),
    });
  }

  return {
    from: fromDate, to: toDate,
    total_standard_cost: Math.round(totalStandard * 100) / 100,
    total_actual_cost: Math.round(totalActual * 100) / 100,
    total_variance: Math.round((totalActual - totalStandard) * 100) / 100,
    runs: rows,
  };
};

// ─────────────────────────────────────────────────────────────
module.exports = {
  autoFinishOverdueWorkOrders,
  // Plans
  fetchPlans, createPlan, updatePlan, deletePlan,
  // BOM
  fetchBOMs, fetchBOMById, createBOM, updateBOM, deleteBOM,
// Work Orders
  fetchWorkOrders, createWorkOrder, updateWorkOrder, deleteWorkOrder, fetchWorkOrderById,
  startProductionRun, finishProductionRun,
  createPurchaseOrderFromShortfall,      // Purchases module integration
  autoCreateWorkOrderForShortfall,       // Sales module integration (make-to-order)
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
  fetchReportsSummary, fetchCostVariance,
};