/**
 * ====================================================
 * WARRANTY + OPENING STOCK SERVICE
 * Append these functions to your existing
 * services/productService.js
 * ====================================================
 */

const pool = require('../config/database');

// ─────────────────────────────────────────────────────────────
// WARRANTIES
// ─────────────────────────────────────────────────────────────

const fetchAllWarranties = async (filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (LOWER(name) LIKE LOWER($${params.length}) OR LOWER(description) LIKE LOWER($${params.length}))`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM product_warranties ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const li = dataParams.length;
  dataParams.push(offset); const oi = dataParams.length;

  const result = await pool.query(
    `SELECT id, name, description, duration, duration_type, created_at, updated_at
     FROM product_warranties
     ${where}
     ORDER BY name ASC
     LIMIT $${li} OFFSET $${oi}`,
    dataParams
  );
  return { warranties: result.rows, total };
};

const fetchWarrantyById = async (id) => {
  const result = await pool.query(
    'SELECT id, name, description, duration, duration_type, created_at, updated_at FROM product_warranties WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

const createWarranty = async ({ name, description, duration, duration_type }) => {
  if (!name?.trim())                   throw new Error('Warranty name is required');
  if (!duration || isNaN(duration))    throw new Error('Duration is required');
  if (!duration_type?.trim())          throw new Error('Duration type is required');

  const allowed = ['days', 'months', 'years'];
  const type    = duration_type.toLowerCase();
  if (!allowed.includes(type))         throw new Error('Duration type must be days, months, or years');

  const result = await pool.query(
    `INSERT INTO product_warranties (name, description, duration, duration_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, duration, duration_type, created_at, updated_at`,
    [name.trim(), description?.trim() || null, parseInt(duration), type]
  );
  return result.rows[0];
};

const updateWarranty = async (id, { name, description, duration, duration_type }) => {
  const existing = await fetchWarrantyById(id);
  if (!existing) throw new Error('Warranty not found');

  const type = duration_type ? duration_type.toLowerCase() : existing.duration_type;

  const result = await pool.query(
    `UPDATE product_warranties
     SET name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         duration      = COALESCE($3, duration),
         duration_type = COALESCE($4, duration_type),
         updated_at    = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING id, name, description, duration, duration_type, updated_at`,
    [
      name?.trim()      || null,
      description !== undefined ? (description?.trim() || null) : null,
      duration    ? parseInt(duration) : null,
      type        || null,
      id
    ]
  );
  return result.rows[0];
};

const deleteWarranty = async (id) => {
  const result = await pool.query(
    'DELETE FROM product_warranties WHERE id = $1 RETURNING id, name',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Warranty not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// OPENING STOCK / STOCK UPDATE
// ─────────────────────────────────────────────────────────────

const setOpeningStock = async (productId, { quantity, type = 'opening', unit_cost = 0 }) => {
  // Verify product exists
  const check = await pool.query('SELECT id, name, current_stock FROM products WHERE id = $1', [productId]);
  if (!check.rows.length) throw new Error('Product not found');

  if (isNaN(quantity) || quantity < 0) throw new Error('Quantity must be a non-negative number');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update current_stock on product
    await client.query(
      `UPDATE products
       SET current_stock = $1,
           updated_at    = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [parseInt(quantity), productId]
    );

    // Log in stock_movements table (if it exists, otherwise skip gracefully)
    try {
      await client.query(
        `INSERT INTO stock_movements (product_id, quantity, type, unit_cost, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [productId, parseInt(quantity), type, parseFloat(unit_cost) || 0, `${type} stock entry`]
      );
    } catch {
      // stock_movements table may not exist yet — not fatal
    }

    await client.query('COMMIT');
    const updated = await client.query('SELECT id, name, current_stock FROM products WHERE id = $1', [productId]);
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  // Warranties
  fetchAllWarranties,
  fetchWarrantyById,
  createWarranty,
  updateWarranty,
  deleteWarranty,
  // Stock
  setOpeningStock,
};