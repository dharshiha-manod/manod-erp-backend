// ═══════════════════════════════════════════════════════════════
// services/salesTargetsSyncService.js
// Background sync: recalculates hrm_sales_targets achieved_* fields
// by reading sales_invoices (read-only, finalized/'Submitted' only)
// and fires 80%/100% milestone notifications. Interval-driven, does
// NOT touch the Sell module's routes, controllers, or tables.
// Enable/disable and interval are controlled via env vars.
// ═══════════════════════════════════════════════════════════════
const pool = require('../config/database');
const salesTargetsService = require('./salesTargetsService');
const notificationService = require('./notificationService');

// ── CONFIG (env-driven, safe defaults) ────────────────────────
const SYNC_ENABLED   = String(process.env.SALES_TARGET_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';
const SYNC_INTERVAL_MS = Number(process.env.SALES_TARGET_SYNC_INTERVAL_MS) || 5 * 60 * 1000; // default 5 min
const SYNC_BATCH_SIZE  = Number(process.env.SALES_TARGET_SYNC_BATCH_SIZE) || 25; // targets processed per micro-batch
const SYNC_BATCH_DELAY_MS = Number(process.env.SALES_TARGET_SYNC_BATCH_DELAY_MS) || 50; // pause between batches

let syncRunning = false; // in-process lock — avoids overlapping runs
let intervalHandle = null;

let schemaReady = false;
async function ensureSyncSchema() {
  if (schemaReady) return;
  await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS notified_milestones TEXT DEFAULT '';`);
  schemaReady = true;
}

function pctFor(target, achieved) {
  const t = Number(target) || 0;
  if (t <= 0) return 0;
  return (Number(achieved) || 0) / t * 100;
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function processOneTarget(t) {
  // Reuses the exact same read-only computation the manual
  // GET /hrm/sales-targets endpoint already uses.
  const live = await salesTargetsService.computeAchievement(t.employee_name, t.month_year);

  const primaryTarget =
    Number(t.order_target) > 0 ? Number(t.order_target) :
    Number(t.customer_target) > 0 ? Number(t.customer_target) :
    Number(t.target_amount) || 0;
  const primaryAchieved =
    Number(t.order_target) > 0 ? live.order_achieved :
    Number(t.customer_target) > 0 ? live.customer_achieved :
    live.achieved_amount;

  const changed =
    Number(t.achieved_amount)     !== live.achieved_amount ||
    Number(t.order_achieved)      !== live.order_achieved ||
    Number(t.customer_achieved)   !== live.customer_achieved ||
    Number(t.collection_achieved) !== live.collection_achieved;

  if (changed) {
    await pool.query(
      `UPDATE hrm_sales_targets SET
         achieved_amount = $1, order_achieved = $2,
         customer_achieved = $3, collection_achieved = $4,
         last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [live.achieved_amount, live.order_achieved, live.customer_achieved, live.collection_achieved, t.id]
    );
  } else {
    await pool.query(`UPDATE hrm_sales_targets SET last_synced_at = NOW() WHERE id = $1`, [t.id]);
  }

  let notifiedCount = 0;
  if (t.employee_id) {
    const pct = pctFor(primaryTarget, primaryAchieved);
    const already = String(t.notified_milestones || '').split(',').filter(Boolean);
    const toAdd = [];

    if (pct >= 100 && !already.includes('100')) {
      await notificationService.notifyUser({
        recipientId: t.employee_id, recipientSource: t.employee_source || 'user',
        module: 'Sales Target', eventType: 'target_completed', recordId: t.id,
        title: `You achieved ${Math.round(pct)}% of your target 🎉`,
        message: `${t.month_year || 'This period'}'s target has been completed.`,
      });
      toAdd.push('100');
      notifiedCount++;
    } else if (pct >= 80 && !already.includes('80')) {
      await notificationService.notifyUser({
        recipientId: t.employee_id, recipientSource: t.employee_source || 'user',
        module: 'Sales Target', eventType: 'target_80_percent', recordId: t.id,
        title: `You're at ${Math.round(pct)}% of your target 🔥`,
        message: `${t.month_year || 'This period'}'s target is almost there — keep going!`,
      });
      toAdd.push('80');
      notifiedCount++;
    }

    if (toAdd.length) {
      const merged = [...new Set([...already, ...toAdd])].join(',');
      await pool.query(`UPDATE hrm_sales_targets SET notified_milestones = $1 WHERE id = $2`, [merged, t.id]);
    }
  }

  return { changed, notifiedCount };
}

/**
 * Recalculates achievement for every sales target in small batches with
 * a short pause between them, so a large target/invoice volume never
 * monopolizes the event loop or the DB connection pool. Guarded against
 * overlapping runs and against duplicate milestone notifications.
 */
async function syncSalesTargetAchievements() {
  if (!SYNC_ENABLED) {
    return { skipped: true, reason: 'disabled_by_config' };
  }
  if (syncRunning) {
    console.log('[salesTargetsSync] Skipped — previous run still in progress');
    return { skipped: true, reason: 'already_running' };
  }
  syncRunning = true;
  const startedAt = Date.now();
  let updated = 0, notified = 0, errors = 0, processed = 0;

  try {
    await ensureSyncSchema();

    const { rows: targets } = await pool.query(
      `SELECT * FROM hrm_sales_targets WHERE month_year IS NOT NULL AND month_year != '' ORDER BY id`
    );

    for (let i = 0; i < targets.length; i += SYNC_BATCH_SIZE) {
      const batch = targets.slice(i, i + SYNC_BATCH_SIZE);

      // Process each batch's targets concurrently (bounded by batch size),
      // but batches themselves run sequentially with a pause between them
      // to avoid saturating the DB pool when there are many targets.
      const results = await Promise.allSettled(batch.map(processOneTarget));

      for (const r of results) {
        processed++;
        if (r.status === 'fulfilled') {
          if (r.value.changed) updated++;
          notified += r.value.notifiedCount;
        } else {
          errors++;
          console.error('[salesTargetsSync] Failed for a target:', r.reason?.message || r.reason);
          // Never throws further — this batch's other rows and all
          // subsequent batches still run.
        }
      }

      if (i + SYNC_BATCH_SIZE < targets.length) {
        await sleep(SYNC_BATCH_DELAY_MS);
      }
    }
  } catch (outerErr) {
    console.error('[salesTargetsSync] Run failed:', outerErr.message);
    errors++;
  } finally {
    syncRunning = false;
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[salesTargetsSync] Done in ${durationMs}ms — processed=${processed} updated=${updated} notified=${notified} errors=${errors}`);
  return { processed, updated, notified, errors, durationMs };
}

/**
 * Starts the interval-based background job. Call once at server boot.
 * No-op (logs and returns null) if disabled via SALES_TARGET_SYNC_ENABLED=false.
 */
function startSalesTargetsSyncJob() {
  if (!SYNC_ENABLED) {
    console.log('[salesTargetsSync] Disabled via SALES_TARGET_SYNC_ENABLED — background sync will not run');
    return null;
  }
  console.log(`[salesTargetsSync] Starting — interval=${SYNC_INTERVAL_MS}ms batchSize=${SYNC_BATCH_SIZE}`);

  // First run shortly after boot (lets DB pool/connections settle),
  // then on the configured interval.
  setTimeout(() => {
    syncSalesTargetAchievements().catch(e => console.error('[salesTargetsSync] initial run error:', e.message));
  }, 10 * 1000);

  intervalHandle = setInterval(() => {
    syncSalesTargetAchievements().catch(e => console.error('[salesTargetsSync] scheduled run error:', e.message));
  }, SYNC_INTERVAL_MS);

  return intervalHandle;
}

function stopSalesTargetsSyncJob() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { syncSalesTargetAchievements, startSalesTargetsSyncJob, stopSalesTargetsSyncJob };