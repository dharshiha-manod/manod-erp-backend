const pool = require('../config/database');

(async () => {
  const { rows: locs } = await pool.query(`SELECT id, location_name FROM business_locations`);
  const matchId = (name) => {
    if (!name) return null;
    const exact = locs.find(l => l.location_name === name);
    if (exact) return exact.id;
    const loose = locs.find(l => l.location_name.trim().toLowerCase() === name.trim().toLowerCase());
    return loose ? loose.id : null; // null = phantom, needs manual review
  };

  const { rows: buckets } = await pool.query(`SELECT product_id, location, quantity FROM product_stock_by_location`);
  for (const b of buckets) {
    const id = matchId(b.location);
    if (id) {
      await pool.query(
        `UPDATE product_stock_by_location SET location_id=$1 WHERE product_id=$2 AND location=$3`,
        [id, b.product_id, b.location]
      );
    } else {
      console.warn(`UNMATCHED phantom location "${b.location}" for product_id=${b.product_id}, qty=${b.quantity} — review manually, not auto-mapped`);
    }
  }

  await pool.query(`UPDATE purchases SET location_id = (SELECT id FROM business_locations WHERE location_name = purchases.location LIMIT 1)`);
  await pool.query(`UPDATE stock_adjustments SET location_id = (SELECT id FROM business_locations WHERE location_name = stock_adjustments.location LIMIT 1)`);
  await pool.query(`UPDATE stock_transfers SET location_from_id = (SELECT id FROM business_locations WHERE location_name = stock_transfers.location_from LIMIT 1)`);
  await pool.query(`UPDATE stock_transfers SET location_to_id = (SELECT id FROM business_locations WHERE location_name = stock_transfers.location_to LIMIT 1)`);
  await pool.query(`UPDATE sells SET location_id = (SELECT id FROM business_locations WHERE location_name = sells.warehouse LIMIT 1)`);

  console.log('Backfill done. Re-run diagnose-stock.js to confirm.');
  process.exit(0);
})();