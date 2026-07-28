const getDefaultLocationId = async (client) => {
  const { rows } = await client.query(
    `SELECT id FROM business_locations ORDER BY is_default DESC, id ASC LIMIT 1`
  );
  if (!rows[0]) throw new Error('No business location exists. Create one in Settings before adjusting stock.');
  return rows[0].id;
};

const adjustStockAtLocation = async (client, productId, locationId, delta, { allowNegative = false } = {}) => {
  const locId = locationId || await getDefaultLocationId(client);
  const existing = await client.query(
    `SELECT quantity FROM product_stock_by_location WHERE product_id=$1 AND location_id=$2 FOR UPDATE`,
    [productId, locId]
  );
  const current = existing.rows[0] ? parseFloat(existing.rows[0].quantity) : 0;
  const next = current + delta;
  if (!allowNegative && next < 0) {
    const { rows: locRow } = await client.query(`SELECT location_name FROM business_locations WHERE id=$1`, [locId]);
    throw new Error(`Insufficient stock at "${locRow[0]?.location_name || locId}": have ${current}, need ${-delta}`);
  }
  if (existing.rows[0]) {
    await client.query(
      `UPDATE product_stock_by_location SET quantity=$1, updated_at=NOW() WHERE product_id=$2 AND location_id=$3`,
      [next, productId, locId]
    );
  } else {
    await client.query(
      `INSERT INTO product_stock_by_location (product_id, location_id, quantity) VALUES ($1,$2,$3)`,
      [productId, locId, next]
    );
  }
  const totalRes = await client.query(
    `SELECT COALESCE(SUM(quantity),0) AS total FROM product_stock_by_location WHERE product_id=$1`,
    [productId]
  );
  await client.query(`UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2`, [totalRes.rows[0].total, productId]);
  return next;
};

const stockAtLocation = async (client, productId, locationId) => {
  const locId = locationId || await getDefaultLocationId(client);
  const r = await client.query(
    `SELECT COALESCE(quantity,0) AS quantity FROM product_stock_by_location WHERE product_id=$1 AND location_id=$2`,
    [productId, locId]
  );
  return r.rows[0] ? parseFloat(r.rows[0].quantity) : 0;
};

const stockByAllLocations = async (client, productId) => {
  const r = await client.query(
    `SELECT bl.id AS location_id, bl.location_name, psl.quantity
     FROM product_stock_by_location psl
     JOIN business_locations bl ON bl.id = psl.location_id
     WHERE psl.product_id=$1 ORDER BY bl.location_name`,
    [productId]
  );
  return r.rows;
};

module.exports = { adjustStockAtLocation, stockAtLocation, stockByAllLocations, getDefaultLocationId, getDefaultLocationName: getDefaultLocationId }; 