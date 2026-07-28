const pool = require('../config/database');

(async () => {
  const { rows: locs } = await pool.query(`SELECT id, location_name, is_default FROM business_locations ORDER BY id`);
  console.log('Real business locations:', locs);

  const { rows: buckets } = await pool.query(`
    SELECT psl.product_id, p.name, psl.location, psl.quantity
    FROM product_stock_by_location psl
    JOIN products p ON p.id = psl.product_id
    ORDER BY p.name, psl.location
  `);
  console.log('\nAll stock buckets (by raw location string):');
  buckets.forEach(b => {
    const known = locs.some(l => l.location_name === b.location);
    console.log(`  product="${b.name}" location="${b.location}" qty=${b.quantity}  ${known ? '' : '<-- PHANTOM, no matching business_locations row'}`);
  });

  const { rows: totals } = await pool.query(`SELECT id, name, current_stock FROM products ORDER BY name`);
  console.log('\nproducts.current_stock (the SUM currently shown in UI):');
  totals.forEach(t => console.log(`  ${t.name}: ${t.current_stock}`));

  process.exit(0);
})();