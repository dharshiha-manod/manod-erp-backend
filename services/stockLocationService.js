const pool = require('../config/database');

// Resolves the real default business location name from the DB instead of
// guessing a hardcoded string. Falls back to the hardcoded name only if no
// business_locations row is marked default (keeps old behavior as a last resort).
const getDefaultLocationName = async (client) => {
  const { rows } = await client.query(
    `SELECT location_name FROM business_locations WHERE is_default = true LIMIT 1`
  );
  return rows[0] ? rows[0].location_name : 'Manodtechnologies (BL0001)';
};

const adjustStockAtLocation = async (client, productId, location, delta, { allowNegative = false } = {}) => {
  const loc = location || await getDefaultLocationName(client);
  const existing = await client.query(
    `SELECT quantity FROM product_stock_by_location WHERE product_id=$1 AND location=$2 FOR UPDATE`,
    [productId, loc]
  );
  const current = existing.rows[0] ? parseFloat(existing.rows[0].quantity) : 0;
  const next = current + delta;
  if (!allowNegative && next < 0) {
    throw new Error(`Insufficient stock at "${loc}": have ${current}, need ${-delta}`);
  }
  if (existing.rows[0]) {
    await client.query(
      `UPDATE product_stock_by_location SET quantity=$1, updated_at=NOW() WHERE product_id=$2 AND location=$3`,
      [next, productId, loc]
    );
  } else {
    await client.query(
      `INSERT INTO product_stock_by_location (product_id, location, quantity) VALUES ($1,$2,$3)`,
      [productId, loc, next]
    );
  }
  const totalRes = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS total FROM product_stock_by_location WHERE product_id=$1`,
    [productId]
  );
  await client.query(`UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2`, [totalRes.rows[0].total, productId]);
  return next;
};

const stockAtLocation = async (client, productId, location) => {
  const loc = location || await getDefaultLocationName(client);
  const r = await client.query(
    `SELECT COALESCE(quantity,0) AS quantity FROM product_stock_by_location WHERE product_id=$1 AND location=$2`,
    [productId, loc]
  );
  return r.rows[0] ? parseFloat(r.rows[0].quantity) : 0;
};

const stockByAllLocations = async (client, productId) => {
  const r = await client.query(
    `SELECT location, quantity FROM product_stock_by_location WHERE product_id=$1 ORDER BY location`,
    [productId]
  );
  return r.rows;
};

module.exports = { adjustStockAtLocation, stockAtLocation, stockByAllLocations, getDefaultLocationName };