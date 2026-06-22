/**
 * ====================================================
 * PRODUCT SERVICE
 * Business logic & database operations for:
 *   - Brands, Units, Variations, Categories, Products
 * ====================================================
 */

const pool = require('../config/database');

// ─────────────────────────────────────────────────────────────
// BRANDS
// ─────────────────────────────────────────────────────────────

const fetchAllBrands = async (filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let query = `
    SELECT id, name, description, created_at, updated_at
    FROM product_brands
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      LOWER(name) LIKE LOWER($${params.length})
      OR LOWER(description) LIKE LOWER($${params.length})
    )`;
  }

  // Count before pagination
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM product_brands WHERE 1=1${
      search ? ` AND (LOWER(name) LIKE LOWER($1) OR LOWER(description) LIKE LOWER($1))` : ''
    }`,
    search ? [`%${search}%`] : []
  );
  const total = parseInt(countResult.rows[0].count);

  query += ` ORDER BY name ASC`;
  params.push(limit);  query += ` LIMIT $${params.length}`;
  params.push(offset); query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  return { brands: result.rows, total };
};

const fetchBrandById = async (id) => {
  const result = await pool.query(
    'SELECT id, name, description, created_at, updated_at FROM product_brands WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

const brandNameExists = async (name, excludeId = null) => {
  let q = 'SELECT id FROM product_brands WHERE LOWER(name) = LOWER($1)';
  const p = [name];
  if (excludeId) { q += ' AND id != $2'; p.push(excludeId); }
  const result = await pool.query(q, p);
  return result.rows.length > 0;
};

const createBrand = async ({ name, description }) => {
  if (!name || !name.trim()) throw new Error('Brand name is required');
  if (await brandNameExists(name)) throw new Error('Brand name already exists');

  const result = await pool.query(
    `INSERT INTO product_brands (name, description)
     VALUES ($1, $2)
     RETURNING id, name, description, created_at, updated_at`,
    [name.trim(), description?.trim() || null]
  );
  return result.rows[0];
};

const updateBrand = async (id, { name, description }) => {
  const existing = await fetchBrandById(id);
  if (!existing) throw new Error('Brand not found');
  if (name && await brandNameExists(name, id)) throw new Error('Brand name already in use');

  const result = await pool.query(
    `UPDATE product_brands
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING id, name, description, updated_at`,
    [name?.trim() || null, description !== undefined ? (description?.trim() || null) : undefined, id]
  );
  return result.rows[0];
};

const deleteBrand = async (id) => {
  const result = await pool.query(
    'DELETE FROM product_brands WHERE id = $1 RETURNING id, name',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Brand not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// UNITS
// ─────────────────────────────────────────────────────────────

const fetchAllUnits = async (filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      LOWER(name) LIKE LOWER($${params.length})
      OR LOWER(short_name) LIKE LOWER($${params.length})
    )`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM product_units ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const limitIdx = dataParams.length;
  dataParams.push(offset); const offsetIdx = dataParams.length;

  const result = await pool.query(
    `SELECT id, name, short_name, allow_decimal, created_at, updated_at
     FROM product_units ${where}
     ORDER BY name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );
  return { units: result.rows, total };
};

const fetchUnitById = async (id) => {
  const result = await pool.query(
    'SELECT id, name, short_name, allow_decimal, created_at, updated_at FROM product_units WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
};

const unitNameExists = async (name, excludeId = null) => {
  let q = 'SELECT id FROM product_units WHERE LOWER(name) = LOWER($1)';
  const p = [name];
  if (excludeId) { q += ' AND id != $2'; p.push(excludeId); }
  const result = await pool.query(q, p);
  return result.rows.length > 0;
};

const createUnit = async ({ name, short_name, allow_decimal }) => {
  if (!name?.trim())       throw new Error('Unit name is required');
  if (!short_name?.trim()) throw new Error('Short name is required');
  if (await unitNameExists(name)) throw new Error('Unit name already exists');

  const result = await pool.query(
    `INSERT INTO product_units (name, short_name, allow_decimal)
     VALUES ($1, $2, $3)
     RETURNING id, name, short_name, allow_decimal, created_at, updated_at`,
    [name.trim(), short_name.trim(), allow_decimal === true || allow_decimal === 'true' || allow_decimal === 'Yes']
  );
  return result.rows[0];
};

const updateUnit = async (id, { name, short_name, allow_decimal }) => {
  const existing = await fetchUnitById(id);
  if (!existing) throw new Error('Unit not found');
  if (name && await unitNameExists(name, id)) throw new Error('Unit name already in use');

  const result = await pool.query(
    `UPDATE product_units
     SET name          = COALESCE($1, name),
         short_name    = COALESCE($2, short_name),
         allow_decimal = COALESCE($3, allow_decimal),
         updated_at    = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, name, short_name, allow_decimal, updated_at`,
    [
      name?.trim() || null,
      short_name?.trim() || null,
      allow_decimal !== undefined
        ? (allow_decimal === true || allow_decimal === 'true' || allow_decimal === 'Yes')
        : null,
      id
    ]
  );
  return result.rows[0];
};

const deleteUnit = async (id) => {
  // Check if unit is in use
  const inUse = await pool.query('SELECT id FROM products WHERE unit_id = $1 LIMIT 1', [id]);
  if (inUse.rows.length > 0) throw new Error('Cannot delete: unit is assigned to products');

  const result = await pool.query(
    'DELETE FROM product_units WHERE id = $1 RETURNING id, name',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Unit not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// VARIATIONS
// ─────────────────────────────────────────────────────────────

const fetchAllVariations = async (filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where += ` AND LOWER(pv.name) LIKE LOWER($${params.length})`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM product_variations pv ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const limitIdx = dataParams.length;
  dataParams.push(offset); const offsetIdx = dataParams.length;

  const result = await pool.query(
    `SELECT
       pv.id,
       pv.name,
       pv.created_at,
       pv.updated_at,
       COALESCE(
         JSON_AGG(
           JSON_BUILD_OBJECT('id', pvv.id, 'value', pvv.value)
           ORDER BY pvv.value
         ) FILTER (WHERE pvv.id IS NOT NULL),
         '[]'
       ) AS values
     FROM product_variations pv
     LEFT JOIN product_variation_values pvv ON pvv.variation_id = pv.id
     ${where}
     GROUP BY pv.id, pv.name, pv.created_at, pv.updated_at
     ORDER BY pv.name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );
  return { variations: result.rows, total };
};

const fetchVariationById = async (id) => {
  const result = await pool.query(
    `SELECT
       pv.id, pv.name, pv.created_at, pv.updated_at,
       COALESCE(
         JSON_AGG(
           JSON_BUILD_OBJECT('id', pvv.id, 'value', pvv.value)
           ORDER BY pvv.value
         ) FILTER (WHERE pvv.id IS NOT NULL),
         '[]'
       ) AS values
     FROM product_variations pv
     LEFT JOIN product_variation_values pvv ON pvv.variation_id = pv.id
     WHERE pv.id = $1
     GROUP BY pv.id, pv.name, pv.created_at, pv.updated_at`,
    [id]
  );
  return result.rows[0] || null;
};

const variationNameExists = async (name, excludeId = null) => {
  let q = 'SELECT id FROM product_variations WHERE LOWER(name) = LOWER($1)';
  const p = [name];
  if (excludeId) { q += ' AND id != $2'; p.push(excludeId); }
  const result = await pool.query(q, p);
  return result.rows.length > 0;
};

const createVariation = async ({ name, values = [] }) => {
  if (!name?.trim()) throw new Error('Variation name is required');
  if (await variationNameExists(name)) throw new Error('Variation name already exists');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const varResult = await client.query(
      'INSERT INTO product_variations (name) VALUES ($1) RETURNING id, name, created_at, updated_at',
      [name.trim()]
    );
    const variation = varResult.rows[0];

    if (values && values.length > 0) {
      const cleanValues = [...new Set(values.map(v => v.trim()).filter(Boolean))];
      for (const val of cleanValues) {
        await client.query(
          'INSERT INTO product_variation_values (variation_id, value) VALUES ($1, $2)',
          [variation.id, val]
        );
      }
    }

    await client.query('COMMIT');
    return await fetchVariationById(variation.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateVariation = async (id, { name, values }) => {
  const existing = await fetchVariationById(id);
  if (!existing) throw new Error('Variation not found');
  if (name && await variationNameExists(name, id)) throw new Error('Variation name already in use');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (name?.trim()) {
      await client.query(
        'UPDATE product_variations SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [name.trim(), id]
      );
    }

    if (values !== undefined) {
      // Replace all values
      await client.query('DELETE FROM product_variation_values WHERE variation_id = $1', [id]);
      const cleanValues = [...new Set(values.map(v => v.trim()).filter(Boolean))];
      for (const val of cleanValues) {
        await client.query(
          'INSERT INTO product_variation_values (variation_id, value) VALUES ($1, $2)',
          [id, val]
        );
      }
    }

    await client.query('COMMIT');
    return await fetchVariationById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteVariation = async (id) => {
  // Cascade will delete values; check if variation exists first
  const result = await pool.query(
    'DELETE FROM product_variations WHERE id = $1 RETURNING id, name',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Variation not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────

const fetchAllCategories = async (filters = {}) => {
  const { search = '', limit = 25, offset = 0 } = filters;

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    where += ` AND LOWER(c.name) LIKE LOWER($${params.length})`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM product_categories c ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const limitIdx = dataParams.length;
  dataParams.push(offset); const offsetIdx = dataParams.length;

  const result = await pool.query(
    `SELECT c.id, c.name, c.parent_id, c.description, c.created_at, c.updated_at,
            p.name AS parent_name
     FROM product_categories c
     LEFT JOIN product_categories p ON p.id = c.parent_id
     ${where}
     ORDER BY p.name NULLS FIRST, c.name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );
  return { categories: result.rows, total };
};

const fetchCategoryById = async (id) => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.parent_id, c.description, c.created_at, c.updated_at,
            p.name AS parent_name
     FROM product_categories c
     LEFT JOIN product_categories p ON p.id = c.parent_id
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const createCategory = async ({ name, parent_id, description }) => {
  if (!name?.trim()) throw new Error('Category name is required');

  const result = await pool.query(
    `INSERT INTO product_categories (name, parent_id, description)
     VALUES ($1, $2, $3)
     RETURNING id, name, parent_id, description, created_at, updated_at`,
    [name.trim(), parent_id || null, description?.trim() || null]
  );
  return result.rows[0];
};

const updateCategory = async (id, { name, parent_id, description }) => {
  const existing = await fetchCategoryById(id);
  if (!existing) throw new Error('Category not found');

  const result = await pool.query(
    `UPDATE product_categories
     SET name        = COALESCE($1, name),
         parent_id   = $2,
         description = COALESCE($3, description),
         updated_at  = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, name, parent_id, description, updated_at`,
    [name?.trim() || null, parent_id !== undefined ? (parent_id || null) : existing.parent_id, description?.trim() || null, id]
  );
  return result.rows[0];
};

const deleteCategory = async (id) => {
  const result = await pool.query(
    'DELETE FROM product_categories WHERE id = $1 RETURNING id, name',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────

const fetchAllProducts = async (filters = {}) => {
  const {
    search = '', status = '', category_id = '',
    brand_id = '', limit = 25, offset = 0
  } = filters;

  const params = [];
  let where = 'WHERE 1=1';

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (
      LOWER(p.name) LIKE LOWER($${params.length})
      OR LOWER(p.sku) LIKE LOWER($${params.length})
    )`;
  }
  if (status) {
    params.push(status);
    where += ` AND p.status = $${params.length}`;
  }
  if (category_id) {
    params.push(parseInt(category_id));
    where += ` AND p.category_id = $${params.length}`;
  }
  if (brand_id) {
    params.push(parseInt(brand_id));
    where += ` AND p.brand_id = $${params.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM products p ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  const dataParams = [...params];
  dataParams.push(limit);  const limitIdx = dataParams.length;
  dataParams.push(offset); const offsetIdx = dataParams.length;

  const result = await pool.query(
    `SELECT
       p.id, p.name, p.sku, p.barcode_type,
       p.unit_id,   pu.name  AS unit,
       p.brand_id,  pb.name  AS brand,
       p.category_id, pc.name AS category,
       p.sub_category_id, sc.name AS sub_category,
       p.business_location,
       p.alert_qty, p.manage_stock, p.description,
       p.weight, p.prep_time,
       p.tax, p.selling_price_tax_type, p.product_type,
       p.purchase_price_exc_tax  AS exc_tax,
       p.purchase_price_inc_tax  AS inc_tax,
       p.margin,
       p.selling_price_exc_tax   AS exc_tax_sell,
       p.image_url, p.status, p.current_stock,
       p.created_at, p.updated_at
     FROM products p
     LEFT JOIN product_units      pu ON pu.id = p.unit_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_categories sc ON sc.id = p.sub_category_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );
  return { products: result.rows, total };
};

const fetchProductById = async (id) => {
  const result = await pool.query(
    `SELECT
       p.id, p.name, p.sku, p.barcode_type,
       p.unit_id,   pu.name  AS unit,
       p.brand_id,  pb.name  AS brand,
       p.category_id, pc.name AS category,
       p.sub_category_id, sc.name AS sub_category,
       p.business_location,
       p.alert_qty, p.manage_stock, p.description,
       p.weight, p.prep_time,
       p.tax, p.selling_price_tax_type, p.product_type,
       p.purchase_price_exc_tax  AS exc_tax,
       p.purchase_price_inc_tax  AS inc_tax,
       p.margin,
       p.selling_price_exc_tax   AS exc_tax_sell,
       p.image_url, p.status, p.current_stock,
       p.created_at, p.updated_at
     FROM products p
     LEFT JOIN product_units      pu ON pu.id = p.unit_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_categories sc ON sc.id = p.sub_category_id
     WHERE p.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const skuExists = async (sku, excludeId = null) => {
  if (!sku || !sku.trim()) return false;
  let q = 'SELECT id FROM products WHERE LOWER(sku) = LOWER($1)';
  const p = [sku.trim()];
  if (excludeId) { q += ' AND id != $2'; p.push(excludeId); }
  const result = await pool.query(q, p);
  return result.rows.length > 0;
};

// Resolve unit/brand/category by name → id
const resolveUnitId = async (unitNameOrId) => {
  if (!unitNameOrId) return null;
  if (!isNaN(unitNameOrId)) return parseInt(unitNameOrId);
  const r = await pool.query('SELECT id FROM product_units WHERE LOWER(name) = LOWER($1)', [unitNameOrId]);
  return r.rows[0]?.id || null;
};

const resolveBrandId = async (brandNameOrId) => {
  if (!brandNameOrId) return null;
  if (!isNaN(brandNameOrId)) return parseInt(brandNameOrId);
  const r = await pool.query('SELECT id FROM product_brands WHERE LOWER(name) = LOWER($1)', [brandNameOrId]);
  return r.rows[0]?.id || null;
};

const resolveCategoryId = async (catNameOrId) => {
  if (!catNameOrId) return null;
  if (!isNaN(catNameOrId)) return parseInt(catNameOrId);
  const r = await pool.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1)', [catNameOrId]);
  return r.rows[0]?.id || null;
};

const validateProductData = (data) => {
  const errors = [];
  if (!data.name?.trim()) errors.push('Product name is required');
  if (!data.unit && !data.unit_id) errors.push('Unit is required');
  return { isValid: errors.length === 0, errors };
};

const createProduct = async (productData) => {
  const { isValid, errors } = validateProductData(productData);
  if (!isValid) throw new Error(errors.join(', '));

  const {
    name, sku, barcode_type,
    unit, unit_id,
    brand, brand_id,
    category, category_id,
    sub_category, sub_category_id,
    business_location, alert_qty, manage_stock,
    description, weight, prep_time,
    tax, selling_price_tax_type, product_type,
    exc_tax, inc_tax, margin, exc_tax_sell,
    image_url, status
  } = productData;

  if (sku && await skuExists(sku)) throw new Error('SKU already exists');

  // Resolve FK ids (support both name-string and numeric id)
  const resolvedUnitId     = unit_id     || await resolveUnitId(unit);
  const resolvedBrandId    = brand_id    || await resolveBrandId(brand);
  const resolvedCategoryId = category_id || await resolveCategoryId(category);
  const resolvedSubCatId   = sub_category_id || await resolveCategoryId(sub_category);

  const result = await pool.query(
    `INSERT INTO products (
       name, sku, barcode_type,
       unit_id, brand_id, category_id, sub_category_id,
       business_location, alert_qty, manage_stock,
       description, weight, prep_time,
       tax, selling_price_tax_type, product_type,
       purchase_price_exc_tax, purchase_price_inc_tax, margin, selling_price_exc_tax,
       image_url, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )
     RETURNING id`,
    [
      name.trim(),
      sku?.trim() || null,
      barcode_type || 'Code 128 (C128)',
      resolvedUnitId,
      resolvedBrandId,
      resolvedCategoryId,
      resolvedSubCatId,
      business_location || 'Manodtechnologies (BL0001)',
      parseFloat(alert_qty) || 0,
      manage_stock !== false,
      description?.trim() || null,
      weight ? parseFloat(weight) : null,
      prep_time ? parseInt(prep_time) : null,
      tax || 'None',
      selling_price_tax_type || 'Exclusive',
      product_type || 'Single',
      parseFloat(exc_tax) || 0,
      parseFloat(inc_tax) || 0,
      parseFloat(margin) || 0,
      parseFloat(exc_tax_sell) || 0,
      image_url || null,
      status || 'Active'
    ]
  );

  return fetchProductById(result.rows[0].id);
};

const updateProduct = async (id, productData) => {
  const existing = await fetchProductById(id);
  if (!existing) throw new Error('Product not found');

  const {
    name, sku, barcode_type,
    unit, unit_id,
    brand, brand_id,
    category, category_id,
    sub_category, sub_category_id,
    business_location, alert_qty, manage_stock,
    description, weight, prep_time,
    tax, selling_price_tax_type, product_type,
    exc_tax, inc_tax, margin, exc_tax_sell,
    image_url, status
  } = productData;

  if (sku && await skuExists(sku, id)) throw new Error('SKU already in use');

  const resolvedUnitId     = unit_id !== undefined     ? unit_id     : (unit     ? await resolveUnitId(unit)     : undefined);
  const resolvedBrandId    = brand_id !== undefined    ? brand_id    : (brand    ? await resolveBrandId(brand)    : undefined);
  const resolvedCategoryId = category_id !== undefined ? category_id : (category ? await resolveCategoryId(category) : undefined);
  const resolvedSubCatId   = sub_category_id !== undefined ? sub_category_id : (sub_category ? await resolveCategoryId(sub_category) : undefined);

  const result = await pool.query(
    `UPDATE products SET
       name                    = COALESCE($1,  name),
       sku                     = COALESCE($2,  sku),
       barcode_type            = COALESCE($3,  barcode_type),
       unit_id                 = COALESCE($4,  unit_id),
       brand_id                = COALESCE($5,  brand_id),
       category_id             = COALESCE($6,  category_id),
       sub_category_id         = COALESCE($7,  sub_category_id),
       business_location       = COALESCE($8,  business_location),
       alert_qty               = COALESCE($9,  alert_qty),
       manage_stock            = COALESCE($10, manage_stock),
       description             = COALESCE($11, description),
       weight                  = COALESCE($12, weight),
       prep_time               = COALESCE($13, prep_time),
       tax                     = COALESCE($14, tax),
       selling_price_tax_type  = COALESCE($15, selling_price_tax_type),
       product_type            = COALESCE($16, product_type),
       purchase_price_exc_tax  = COALESCE($17, purchase_price_exc_tax),
       purchase_price_inc_tax  = COALESCE($18, purchase_price_inc_tax),
       margin                  = COALESCE($19, margin),
       selling_price_exc_tax   = COALESCE($20, selling_price_exc_tax),
       image_url               = COALESCE($21, image_url),
       status                  = COALESCE($22, status),
       updated_at              = CURRENT_TIMESTAMP
     WHERE id = $23
     RETURNING id`,
    [
      name?.trim()                  || null,
      sku?.trim()                   || null,
      barcode_type                  || null,
      resolvedUnitId                ?? null,
      resolvedBrandId               ?? null,
      resolvedCategoryId            ?? null,
      resolvedSubCatId              ?? null,
      business_location             || null,
      alert_qty !== undefined ? parseFloat(alert_qty) : null,
      manage_stock !== undefined ? Boolean(manage_stock) : null,
      description?.trim()           || null,
      weight     !== undefined ? parseFloat(weight)    : null,
      prep_time  !== undefined ? parseInt(prep_time)   : null,
      tax                           || null,
      selling_price_tax_type        || null,
      product_type                  || null,
      exc_tax    !== undefined ? parseFloat(exc_tax)   : null,
      inc_tax    !== undefined ? parseFloat(inc_tax)   : null,
      margin     !== undefined ? parseFloat(margin)    : null,
      exc_tax_sell !== undefined ? parseFloat(exc_tax_sell) : null,
      image_url                     || null,
      status                        || null,
      id
    ]
  );

  return fetchProductById(result.rows[0].id);
};

const deleteProduct = async (id) => {
  const result = await pool.query(
    'DELETE FROM products WHERE id = $1 RETURNING id, name, sku',
    [id]
  );
  if (result.rows.length === 0) throw new Error('Product not found');
  return result.rows[0];
};

const updateProductStatus = async (id, status) => {
  if (!['Active', 'Inactive'].includes(status)) throw new Error('Invalid status');
  const result = await pool.query(
    'UPDATE products SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, status',
    [status, id]
  );
  if (result.rows.length === 0) throw new Error('Product not found');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  // Brands
  fetchAllBrands, fetchBrandById, createBrand, updateBrand, deleteBrand,
  // Units
  fetchAllUnits, fetchUnitById, createUnit, updateUnit, deleteUnit,
  // Variations
  fetchAllVariations, fetchVariationById, createVariation, updateVariation, deleteVariation,
  // Categories
  fetchAllCategories, fetchCategoryById, createCategory, updateCategory, deleteCategory,
  // Products
  fetchAllProducts, fetchProductById, createProduct, updateProduct, deleteProduct, updateProductStatus,
};