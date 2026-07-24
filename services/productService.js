/**
 * ====================================================
 * PRODUCT SERVICE
 * Business logic & database operations for:
 *   - Brands, Units, Variations, Categories, Products
 * ====================================================
 * UPDATED: products now carry `item_type`
 * ('raw_material' | 'finished_good' | 'both') so the
 * Manufacturing module can filter dropdowns correctly.
 */

const pool = require('../config/database');
const contactService = require('./contactService');

// ── SCHEMA MIGRATION (idempotent) ────────────────────────────────────────────
// products didn't have a default_supplier_id column — needed to remember
// which supplier a product is normally purchased from (set during manual
// entry or Product Import), so Purchases can auto-select it.
let productSchemaReady = false;
const ensureProductSchema = async () => {
  if (productSchemaReady) return;
  try {
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS default_supplier_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20);`);
    await pool.query(`ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS default_hsn_code VARCHAR(20);`);
    productSchemaReady = true;
  } catch (err) {
    console.error('products schema migration warning:', err.message);
    productSchemaReady = true;
  }
};

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
  await ensureProductSchema();
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
    `SELECT c.id, c.name, c.parent_id, c.description, c.default_hsn_code, c.created_at, c.updated_at,
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
  await ensureProductSchema();
  const result = await pool.query(
    `SELECT c.id, c.name, c.parent_id, c.description, c.default_hsn_code, c.created_at, c.updated_at,
            p.name AS parent_name
     FROM product_categories c
     LEFT JOIN product_categories p ON p.id = c.parent_id
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const createCategory = async ({ name, parent_id, description, default_hsn_code }) => {
  if (!name?.trim()) throw new Error('Category name is required');
  await ensureProductSchema();

  const result = await pool.query(
    `INSERT INTO product_categories (name, parent_id, description, default_hsn_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, parent_id, description, default_hsn_code, created_at, updated_at`,
    [name.trim(), parent_id || null, description?.trim() || null, default_hsn_code?.trim() || null]
  );
  return result.rows[0];
};

const updateCategory = async (id, { name, parent_id, description, default_hsn_code }) => {
  await ensureProductSchema();
  const existing = await fetchCategoryById(id);
  if (!existing) throw new Error('Category not found');

  const result = await pool.query(
    `UPDATE product_categories
     SET name             = COALESCE($1, name),
         parent_id        = $2,
         description      = COALESCE($3, description),
         default_hsn_code = $4,
         updated_at       = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING id, name, parent_id, description, default_hsn_code, updated_at`,
    [
      name?.trim() || null,
      parent_id !== undefined ? (parent_id || null) : existing.parent_id,
      description?.trim() || null,
      default_hsn_code !== undefined ? (default_hsn_code?.trim() || null) : existing.default_hsn_code,
      id
    ]
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
       p.item_type,
       p.variation_template,
       p.purchase_price_exc_tax  AS exc_tax,
       p.purchase_price_inc_tax  AS inc_tax,
       p.margin,
       p.selling_price_exc_tax   AS exc_tax_sell,
     p.image_url, p.status, p.current_stock, p.warranty,
p.image_url, p.status, p.current_stock, p.warranty,
  p.default_supplier_id, sup.contact_name AS default_supplier_name,
       p.hsn_code,
       p.created_at, p.updated_at
     FROM products p
     LEFT JOIN product_units      pu  ON pu.id = p.unit_id
     LEFT JOIN product_brands     pb  ON pb.id = p.brand_id
     LEFT JOIN product_categories pc  ON pc.id = p.category_id
     LEFT JOIN product_categories sc  ON sc.id = p.sub_category_id
     LEFT JOIN contacts           sup ON sup.id = p.default_supplier_id
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
       p.item_type,
       p.variation_template,
       p.purchase_price_exc_tax  AS exc_tax,
       p.purchase_price_inc_tax  AS inc_tax,
       p.margin,
       p.selling_price_exc_tax   AS exc_tax_sell,
    p.image_url, p.status, p.current_stock, p.warranty,
       p.default_supplier_id, sup.name AS default_supplier_name,
       p.hsn_code,
       p.created_at, p.updated_at
     FROM products p
     LEFT JOIN product_units      pu  ON pu.id = p.unit_id
     LEFT JOIN product_brands     pb  ON pb.id = p.brand_id
     LEFT JOIN product_categories pc  ON pc.id = p.category_id
     LEFT JOIN product_categories sc  ON sc.id = p.sub_category_id
     LEFT JOIN contacts           sup ON sup.id = p.default_supplier_id
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
  if (!unitNameOrId || !String(unitNameOrId).trim()) return null;
  if (!isNaN(unitNameOrId)) return parseInt(unitNameOrId);
  const r = await pool.query('SELECT id FROM product_units WHERE LOWER(name) = LOWER($1)', [unitNameOrId]);
  return r.rows[0]?.id || null;
};

const resolveBrandId = async (brandNameOrId) => {
  if (!brandNameOrId || !String(brandNameOrId).trim()) return null;
  if (!isNaN(brandNameOrId)) return parseInt(brandNameOrId);
  const r = await pool.query('SELECT id FROM product_brands WHERE LOWER(name) = LOWER($1)', [brandNameOrId]);
  return r.rows[0]?.id || null;
};

const resolveCategoryId = async (catNameOrId) => {
  if (!catNameOrId || !String(catNameOrId).trim()) return null;
  if (!isNaN(catNameOrId)) return parseInt(catNameOrId);
  const r = await pool.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1)', [catNameOrId]);
  return r.rows[0]?.id || null;
};

// Resolve default_supplier by name/code or numeric id — supports both a
// direct supplier_id and a supplier name/code coming from Product Import.
const resolveSupplierId = async (supplierNameOrId) => {
  if (!supplierNameOrId || !String(supplierNameOrId).trim()) return null;
  if (!isNaN(supplierNameOrId)) return parseInt(supplierNameOrId);
  const r = await pool.query(
    `SELECT id FROM contacts
     WHERE contact_type IN ('Suppliers','Both')
       AND (LOWER(contact_name) = LOWER($1) OR LOWER(contact_id) = LOWER($1))
     LIMIT 1`,
    [String(supplierNameOrId).trim()]
  );
  return r.rows[0]?.id || null;
};

// Find an existing product by exact SKU, or by exact name match if SKU is
// absent — used by Product Import to decide "create" vs "update" per row.
const findExistingProductForImport = async ({ name, sku }) => {
  if (sku && String(sku).trim()) {
    const bySku = await pool.query('SELECT id FROM products WHERE LOWER(sku) = LOWER($1)', [String(sku).trim()]);
    if (bySku.rows[0]) return bySku.rows[0].id;
  }
  if (name && String(name).trim()) {
    const byName = await pool.query('SELECT id FROM products WHERE LOWER(name) = LOWER($1)', [String(name).trim()]);
    if (byName.rows[0]) return byName.rows[0].id;
  }
  return null;
};

const validateProductData = (data) => {
  const errors = [];
  if (!data.name?.trim()) errors.push('Product name is required');
  if (!data.unit && !data.unit_id) errors.push('Unit is required');
  return { isValid: errors.length === 0, errors };
};

const createProduct = async (productData) => {
  await ensureProductSchema();
  const { isValid, errors } = validateProductData(productData);
  if (!isValid) throw new Error(errors.join(', '));
const {
    name, sku, barcode_type,
    unit, unit_id,
    brand, brand_id,
    category, category_id,
    sub_category, sub_category_id,
    variation_template,
    business_location, alert_qty, manage_stock,
    description, weight, prep_time,
    tax, selling_price_tax_type, product_type,
    item_type, warranty,
    exc_tax, inc_tax, margin, exc_tax_sell,
    opening_stock,
   default_supplier_id, default_supplier,
    image, image_url, status, hsn_code
  } = productData;

  if (sku && await skuExists(sku)) throw new Error('SKU already exists');

  // Resolve FK ids (support both name-string and numeric id)
  const resolvedUnitId     = unit_id     || await resolveUnitId(unit);
  const resolvedBrandId    = brand_id    || await resolveBrandId(brand);
  const resolvedCategoryId = category_id || await resolveCategoryId(category);
  const resolvedSubCatId   = sub_category_id || await resolveCategoryId(sub_category);
  const resolvedSupplierId = default_supplier_id || await resolveSupplierId(default_supplier);
const resolvedLocation = business_location || 'Manodtechnologies (BL0001)';
const result = await pool.query(
    `INSERT INTO products (
       name, sku, barcode_type,
       unit_id, brand_id, category_id, sub_category_id,
       variation_template,
       business_location, alert_qty, manage_stock,
       description, weight, prep_time,
      tax, selling_price_tax_type, product_type, item_type, warranty,
       purchase_price_exc_tax, purchase_price_inc_tax, margin, selling_price_exc_tax,
       current_stock, image_url, status, default_supplier_id, hsn_code
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
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
      variation_template?.trim() || null,
      resolvedLocation,
      parseFloat(alert_qty) || 0,
      manage_stock !== false,
      description?.trim() || null,
      weight ? parseFloat(weight) : null,
      prep_time ? parseInt(prep_time) : null,
      tax || 'None',
      selling_price_tax_type || 'Exclusive',
      product_type || 'Single',
     item_type || 'Finished Product',
      warranty?.trim() || null,
      parseFloat(exc_tax) || 0,
      parseFloat(inc_tax) || 0,
      parseFloat(margin) || 0,
      parseFloat(exc_tax_sell) || 0,
      parseFloat(opening_stock) || 0,
      image_url || image || null,
status || 'Active',
      resolvedSupplierId,
      hsn_code?.trim() || null
    ]
  );

  // Seed the new product's opening stock into the per-location table too,
  // so it isn't invisible to stockLocationService until the first sale/transfer.
  try {
    await pool.query(
      `INSERT INTO product_stock_by_location (product_id, location, quantity)
       VALUES ($1, $2, $3) ON CONFLICT (product_id, location) DO NOTHING`,
      [result.rows[0].id, resolvedLocation, parseFloat(opening_stock) || 0]
    );
  } catch (seedErr) {
    console.error('[createProduct] stock-by-location seed warning:', seedErr.message);
  }

  return fetchProductById(result.rows[0].id);
};
const updateProduct = async (id, productData) => {
  await ensureProductSchema();
  const existing = await fetchProductById(id);
  if (!existing) throw new Error('Product not found');
const {
    name, sku, barcode_type,
    unit, unit_id,
    brand, brand_id,
    category, category_id,
    sub_category, sub_category_id,
    variation_template,
    business_location, alert_qty, manage_stock,
    description, weight, prep_time,
   tax, selling_price_tax_type, product_type,
    item_type, warranty,
    exc_tax, inc_tax, margin, exc_tax_sell,
    opening_stock,
   default_supplier_id, default_supplier,
    image, image_url, status, hsn_code
  } = productData;

  if (sku && await skuExists(sku, id)) throw new Error('SKU already in use');

  const resolvedUnitId     = unit_id !== undefined     ? unit_id     : (unit     ? await resolveUnitId(unit)     : undefined);
  const resolvedBrandId    = brand_id !== undefined    ? brand_id    : (brand    ? await resolveBrandId(brand)    : undefined);
  const resolvedCategoryId = category_id !== undefined ? category_id : (category ? await resolveCategoryId(category) : undefined);
  const resolvedSubCatId   = sub_category_id !== undefined ? sub_category_id : (sub_category ? await resolveCategoryId(sub_category) : undefined);
  const resolvedSupplierId = default_supplier_id !== undefined ? default_supplier_id : (default_supplier ? await resolveSupplierId(default_supplier) : undefined);
const result = await pool.query(
    `UPDATE products SET
       name                    = COALESCE($1,  name),
       sku                     = COALESCE($2,  sku),
       barcode_type            = COALESCE($3,  barcode_type),
       unit_id                 = COALESCE($4,  unit_id),
       brand_id                = COALESCE($5,  brand_id),
       category_id             = COALESCE($6,  category_id),
       sub_category_id         = COALESCE($7,  sub_category_id),
       variation_template      = COALESCE($8,  variation_template),
       business_location       = COALESCE($9,  business_location),
       alert_qty               = COALESCE($10, alert_qty),
       manage_stock            = COALESCE($11, manage_stock),
       description             = COALESCE($12, description),
       weight                  = COALESCE($13, weight),
       prep_time               = COALESCE($14, prep_time),
       tax                     = COALESCE($15, tax),
       selling_price_tax_type  = COALESCE($16, selling_price_tax_type),
   product_type            = COALESCE($17, product_type),
       item_type               = COALESCE($18, item_type),
       warranty                = COALESCE($19, warranty),
       purchase_price_exc_tax  = COALESCE($20, purchase_price_exc_tax),
       purchase_price_inc_tax  = COALESCE($21, purchase_price_inc_tax),
       margin                  = COALESCE($22, margin),
       selling_price_exc_tax   = COALESCE($23, selling_price_exc_tax),
       current_stock           = COALESCE($24, current_stock),
       image_url               = COALESCE($25, image_url),
    status                  = COALESCE($26, status),
       default_supplier_id     = COALESCE($27, default_supplier_id),
       hsn_code                = COALESCE($28, hsn_code),
       updated_at              = CURRENT_TIMESTAMP
     WHERE id = $29
     RETURNING id`,
    [
      name?.trim()                  || null,
      sku?.trim()                   || null,
      barcode_type                  || null,
      resolvedUnitId                ?? null,
      resolvedBrandId               ?? null,
      resolvedCategoryId            ?? null,
      resolvedSubCatId              ?? null,
      variation_template?.trim()    || null,
      business_location             || null,
(alert_qty !== undefined && alert_qty !== null && alert_qty !== "" && !isNaN(parseFloat(alert_qty))) ? parseFloat(alert_qty) : null,
      manage_stock !== undefined ? Boolean(manage_stock) : null,
      description?.trim()           || null,
      (weight !== undefined && weight !== null && weight !== "" && !isNaN(parseFloat(weight))) ? parseFloat(weight) : null,
      (prep_time !== undefined && prep_time !== null && prep_time !== "" && !isNaN(parseInt(prep_time))) ? parseInt(prep_time) : null,
      tax                           || null,
      selling_price_tax_type        || null,
      product_type                  || null,
    item_type                      || null,
      warranty?.trim()               || null,
     (exc_tax !== undefined && exc_tax !== null && exc_tax !== "" && !isNaN(parseFloat(exc_tax))) ? parseFloat(exc_tax) : null,
      (inc_tax !== undefined && inc_tax !== null && inc_tax !== "" && !isNaN(parseFloat(inc_tax))) ? parseFloat(inc_tax) : null,
      (margin !== undefined && margin !== null && margin !== "" && !isNaN(parseFloat(margin))) ? parseFloat(margin) : null,
      (exc_tax_sell !== undefined && exc_tax_sell !== null && exc_tax_sell !== "" && !isNaN(parseFloat(exc_tax_sell))) ? parseFloat(exc_tax_sell) : null,
    opening_stock !== undefined && opening_stock !== null && opening_stock !== '' && !isNaN(opening_stock) ? parseInt(opening_stock) : null,
     image_url || image || null,
 status                        || null,
      resolvedSupplierId            ?? null,
      hsn_code?.trim()               || null,
      id
    ]
  );

  return fetchProductById(result.rows[0].id);
};
const deleteProduct = async (id) => {
  try {
    const result = await pool.query(
      'DELETE FROM products WHERE id = $1 RETURNING id, name, sku',
      [id]
    );
    if (result.rows.length === 0) throw new Error('Product not found');
    return result.rows[0];
  } catch (err) {
    if (err.code === '23503') {
      throw new Error('Cannot delete: this product is referenced in stock adjustments, sales, or other records. Deactivate it instead.');
    }
    throw err;
  }
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
// BULK IMPORT PRODUCTS (from Excel/CSV via Import Products page)
// ─────────────────────────────────────────────────────────────
// For each row:
//   1. Find or create the product (by SKU, else by name).
//   2. If a supplier name/code is present, find or create that supplier
//      as a contact, and link it as the product's default_supplier_id.
//   3. If opening stock > 0, create a real Purchase transaction (status
//      'Received') instead of writing current_stock directly — this keeps
//      the Purchase List and stock-from-purchases invariant intact.
// Runs row-by-row (not one big transaction) so a single bad row doesn't
// block the rest of the file — mirrors bulkImportContacts' error style.
const bulkImportProducts = async (rows, userId) => {
  await ensureProductSchema();
  const purchaseService = require('./purchaseService'); // lazy require avoids circular import at module load

  const created = [];
  const errors  = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const client = await pool.connect();
    try {
      if (!r.name || !String(r.name).trim()) throw new Error('Product name is required');
      if (!r.unit || !String(r.unit).trim()) throw new Error('Unit is required');

      await client.query('BEGIN');

      // ── Resolve / link supplier (name or code) ──
      let supplierId = null;
      const supplierRef = (r.supplierName || r.supplier_name || r.supplierCode || r.supplier_code || '').toString().trim();
      if (supplierRef) {
        supplierId = await contactService.findOrCreateSupplierByName(supplierRef, client);
      }

      // ── Find existing product (by SKU, else name) or create it ──
      let productId = await findExistingProductForImport({ name: r.name, sku: r.sku });
const openingStockQty = parseFloat(r.openingStock ?? r.opening_stock) || 0;
      const purchasePrice   = parseFloat(r.purchasePrice ?? r.purchase_price ?? r.exc_tax) || 0;
      const sellingPrice    = parseFloat(r.sellingPrice  ?? r.selling_price  ?? r.exc_tax_sell) || 0;
    const paidAmount      = parseFloat(r.paidAmount ?? r.paid_amount ?? r['Paid Amount']) || 0;

      const resolvedUnitId     = await resolveUnitId(r.unit);
      const resolvedBrandId    = await resolveBrandId(r.brand);
      const resolvedCategoryId = await resolveCategoryId(r.category);

      if (!resolvedUnitId) throw new Error(`Unit "${r.unit}" not found`);

      if (!productId) {
        const insertRes = await client.query(
          `INSERT INTO products (
             name, sku, unit_id, brand_id, category_id,
             purchase_price_exc_tax, selling_price_exc_tax,
             current_stock, status, default_supplier_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Active',$9)
           RETURNING id`,
          [
            r.name.trim(),
            r.sku?.trim() || null,
            resolvedUnitId,
            resolvedBrandId,
            resolvedCategoryId,
            purchasePrice,
            sellingPrice,
            0, // stock is applied via the Purchase transaction below, not written directly
            supplierId,
          ]
        );
        productId = insertRes.rows[0].id;
      } else if (supplierId) {
        // Existing product — link/refresh its default supplier if the sheet provided one
        await client.query(
          `UPDATE products SET default_supplier_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [supplierId, productId]
        );
      }

      await client.query('COMMIT');

      // ── Opening stock → real Purchase transaction (outside the row txn;
      // purchaseService manages its own transaction/stock-impact logic) ──
    if (openingStockQty > 0) {
        await purchaseService.createPurchase(
          {
            supplier_id: supplierId,
            purchase_status: 'Received',
            location: r.openingStockLocation || r.opening_stock_location || undefined,
            notes: 'Auto-created from Product Import (opening stock)',
            items: [{
              product_id: productId,
              product_name: r.name.trim(),
              product_sku: r.sku || null,
              quantity: openingStockQty,
              unit_cost: purchasePrice,
              discount_pct: 0,
              margin_pct: 0,
            }],
            amount_paid: paidAmount,
          },
          userId
        );
      }

      created.push({ id: productId, name: r.name });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      errors.push({ row: i + 1, error: err.message });
    } finally {
      client.release();
    }
  }

  return { created: created.length, failed: errors.length, errors };
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
  bulkImportProducts,
};