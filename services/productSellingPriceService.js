/**
 * ====================================================
 * PRODUCT SELLING PRICE SERVICE
 * Links a product to per-group prices (Retail, Wholesale, VIP, etc.)
 * ====================================================
 */

const pool = require('../config/database');

// Get all group prices set for a specific product, joined with group info
const fetchPricesByProduct = async (productId) => {
  const result = await pool.query(
    `SELECT
       psp.id, psp.product_id, psp.selling_price_group_id, psp.selling_price,
       psp.created_at, psp.updated_at,
       spg.name AS group_name, spg.type AS group_type, spg.percentage AS group_percentage
     FROM product_selling_prices psp
     JOIN selling_price_groups spg ON spg.id = psp.selling_price_group_id
     WHERE psp.product_id = $1
     ORDER BY spg.is_default DESC, spg.name ASC`,
    [productId]
  );
  return result.rows;
};

// Replace/insert group prices for a product (upsert per group)
const upsertPrices = async (productId, prices = []) => {
  if (!productId) throw new Error('Product ID is required');
  if (!Array.isArray(prices)) throw new Error('Prices must be an array');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const p of prices) {
      const groupId = parseInt(p.selling_price_group_id);
      const price    = parseFloat(p.selling_price);
      if (!groupId || isNaN(price)) continue;

      await client.query(
        `INSERT INTO product_selling_prices (product_id, selling_price_group_id, selling_price, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (product_id, selling_price_group_id)
         DO UPDATE SET selling_price = EXCLUDED.selling_price, updated_at = CURRENT_TIMESTAMP`,
        [productId, groupId, price]
      );
    }

    await client.query('COMMIT');
    return await fetchPricesByProduct(productId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Remove a single group price for a product (e.g. user clears the field)
const deletePrice = async (productId, groupId) => {
  const result = await pool.query(
    'DELETE FROM product_selling_prices WHERE product_id = $1 AND selling_price_group_id = $2 RETURNING id',
    [productId, groupId]
  );
  return result.rows[0] || null;
};

module.exports = {
  fetchPricesByProduct,
  upsertPrices,
  deletePrice,
};