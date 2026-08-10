/**
 * ====================================================
 * SELLING PRICE GROUP SERVICE
 * Business logic & database operations
 * ====================================================
 */

const pool = require('../config/database');

const fetchAllGroups = async (industryId, filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let where = 'WHERE industry_id = $1';
  const params = [industryId];

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      LOWER(name) LIKE LOWER($${params.length})
      OR LOWER(description) LIKE LOWER($${params.length})
    )`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM selling_price_groups ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const limitIdx = dataParams.length;
  dataParams.push(offset); const offsetIdx = dataParams.length;

  const result = await pool.query(
    `SELECT id, name, description, percentage, type, is_default, created_at, updated_at
     FROM selling_price_groups ${where}
     ORDER BY is_default DESC, name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );
  return { groups: result.rows, total };
};
const fetchGroupById = async (id, industryId) => {
  const result = await pool.query(
    'SELECT id, name, description, percentage, type, is_default, created_at, updated_at FROM selling_price_groups WHERE id = $1 AND industry_id = $2',
    [id, industryId]
  );
  return result.rows[0] || null;
};

const groupNameExists = async (industryId, name, excludeId = null) => {
  let q = 'SELECT id FROM selling_price_groups WHERE LOWER(name) = LOWER($1) AND industry_id = $2';
  const p = [name, industryId];
  if (excludeId) { q += ' AND id != $3'; p.push(excludeId); }
  const result = await pool.query(q, p);
  return result.rows.length > 0;
};
const createGroup = async (industryId, { name, description, percentage, type, is_default }) => {
  if (!name?.trim()) throw new Error('Group name is required');
  if (percentage === undefined || percentage === null || percentage === '') throw new Error('Percentage is required');
  if (await groupNameExists(industryId, name)) throw new Error('Group name already exists');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If this one is set default, unset any existing default first (within this industry only)
    if (is_default) {
      await client.query('UPDATE selling_price_groups SET is_default = FALSE WHERE is_default = TRUE AND industry_id = $1', [industryId]);
    }

    const result = await client.query(
      `INSERT INTO selling_price_groups (name, description, percentage, type, is_default, industry_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, percentage, type, is_default, created_at, updated_at`,
      [
        name.trim(),
        description?.trim() || null,
        parseFloat(percentage) || 0,
        type === 'Markup' ? 'Markup' : 'Discount',
        is_default === true || is_default === 'true',
        industryId
      ]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateGroup = async (id, industryId, { name, description, percentage, type, is_default }) => {
  const existing = await fetchGroupById(id, industryId);
  if (!existing) throw new Error('Selling price group not found');
  if (name && await groupNameExists(industryId, name, id)) throw new Error('Group name already in use');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (is_default === true || is_default === 'true') {
      await client.query('UPDATE selling_price_groups SET is_default = FALSE WHERE is_default = TRUE AND id != $1 AND industry_id = $2', [id, industryId]);
    }

    const result = await client.query(
      `UPDATE selling_price_groups
       SET name        = COALESCE($1, name),
           description = $2,
           percentage  = COALESCE($3, percentage),
           type        = COALESCE($4, type),
           is_default  = COALESCE($5, is_default),
           updated_at  = CURRENT_TIMESTAMP
       WHERE id = $6 AND industry_id = $7
       RETURNING id, name, description, percentage, type, is_default, updated_at`,
      [
        name?.trim() || null,
        description !== undefined ? (description?.trim() || null) : existing.description,
        percentage !== undefined ? parseFloat(percentage) : null,
        type === 'Markup' || type === 'Discount' ? type : null,
        is_default !== undefined ? (is_default === true || is_default === 'true') : null,
        id,
        industryId
      ]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
const deleteGroup = async (id, industryId) => {
  // Check if group is referenced in product_selling_prices
  const inUse = await pool.query(
    'SELECT id FROM product_selling_prices WHERE selling_price_group_id = $1 LIMIT 1',
    [id]
  );
  if (inUse.rows.length > 0) {
    throw new Error('Cannot delete: this price group is assigned to one or more products');
  }

  const result = await pool.query(
    'DELETE FROM selling_price_groups WHERE id = $1 AND industry_id = $2 RETURNING id, name',
    [id, industryId]
  );
  if (result.rows.length === 0) throw new Error('Selling price group not found');
  return result.rows[0];
};
module.exports = {
  fetchAllGroups,
  fetchGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
};