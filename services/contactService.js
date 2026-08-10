/**
 * ====================================================
 * CONTACT SERVICE  (FIXED)
 * Fixes:
 *  1. contact_name NOT NULL violation — INSERT now uses `contact_name` column
 *     and buildName never returns '—' (returns first_name or mobile as last resort)
 *  2. contactType filter — handles both 'Suppliers'/'Customers' AND 'supplier'/'customer'
 *  3. updateContact — also writes contact_name on UPDATE
 * UPDATED: Industry Workspace Isolation — contacts & customer_groups now
 * scoped by industry_id (same pattern as Products/Purchases/Sales/CRM).
 * ====================================================
 */

const pool = require('../config/database');

// ── SCHEMA MIGRATION (idempotent) — Industry Workspace Isolation ─────────────
// contacts / customer_groups didn't have industry_id. This adds the column +
// index (safe if already present via industryService's ISOLATED_TABLES boot
// migration) and then backfills any legacy rows that are still NULL.
// Backfill rule: assign to the earliest-created active industry (MIN(id))
// for that row's business — NEVER overwrites a row that already has an
// industry_id. Safe to run on every boot (idempotent).
let contactSchemaReady = false;
const ensureContactSchema = async () => {
  if (contactSchemaReady) return;
  try {
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS industry_id INTEGER;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_industry_id ON contacts(industry_id);`);
    await pool.query(`ALTER TABLE customer_groups ADD COLUMN IF NOT EXISTS industry_id INTEGER;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_groups_industry_id ON customer_groups(industry_id);`);

    await backfillLegacyIndustryId();

    contactSchemaReady = true;
  } catch (err) {
    console.error('contacts schema migration warning:', err.message);
    contactSchemaReady = true; // don't loop-crash the server
  }
};

// ── One-time (idempotent) backfill: legacy rows with industry_id IS NULL ─────
// only, assigned to MIN(id) active industry per business. Never touches rows
// that already carry an industry_id. Safe to call on every boot / repeatedly.
const backfillLegacyIndustryId = async () => {
  try {
    await pool.query(`
      UPDATE contacts c
      SET industry_id = sub.default_industry_id
      FROM (
        SELECT MIN(id) AS default_industry_id FROM industries WHERE is_active = true
      ) sub
      WHERE c.industry_id IS NULL
        AND sub.default_industry_id IS NOT NULL
    `);

    await pool.query(`
      UPDATE customer_groups cg
      SET industry_id = sub.default_industry_id
      FROM (
        SELECT MIN(id) AS default_industry_id FROM industries WHERE is_active = true
      ) sub
      WHERE cg.industry_id IS NULL
        AND sub.default_industry_id IS NOT NULL
    `);
  } catch (err) {
    console.error('contacts industry_id backfill warning:', err.message);
  }
};

// ── Helper: build full display name ──────────────────────────────────────────
// FIXED: never returns '—'; always returns a non-empty string so NOT NULL is satisfied
const buildName = (data) => {
  const isIndividual = data.is_individual !== false && data.is_individual !== 'false';

  if (!isIndividual) {
    const biz = (data.businessName || data.business_name || '').trim();
    if (biz) return biz;
  }

  const parts = [
    data.prefix,
    data.firstName || data.first_name,
    data.middleName || data.middle_name,
    data.lastName || data.last_name,
  ].map((s) => (s || '').trim()).filter(Boolean);

  if (parts.length) return parts.join(' ');

  return (
    (data.businessName || data.business_name || '').trim() ||
    (data.mobile || '').trim() ||
    'Unknown'
  );
};

// ── Helper: normalize contactType param ──────────────────────────────────────
const normalizeType = (raw = '') => {
  const t = raw.trim().toLowerCase();
  if (t === 'customers' || t === 'customer') return 'Customers';
  if (t === 'suppliers' || t === 'supplier') return 'Suppliers';
  if (t === 'both') return 'Both';
  return raw.trim();
};

// ── Adjust advance balance ────────────────────────────────────────────────────
const adjustAdvanceBalance = async (contactId, delta) => {
  if (!contactId || !delta) return null;
  const result = await pool.query(
    `UPDATE contacts
     SET advance_balance = GREATEST(0, COALESCE(advance_balance,0) + $1),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, advance_balance`,
    [delta, contactId]
  );
  return result.rows[0] || null;
};

// ── Helper: auto-generate contact_id (now scoped per industry) ───────────────
const generateContactId = async (industryId, contactType) => {
  const prefix = normalizeType(contactType) === 'Customers' ? 'CO' : 'SUP';
  const scopeClause = industryId ? ` AND industry_id = $2` : '';
  const scopeParams = industryId ? [`${prefix}%`, industryId] : [`${prefix}%`];
  const result = await pool.query(
    `SELECT contact_id FROM contacts
     WHERE contact_id LIKE $1 ${scopeClause}`,
    scopeParams
  );

  let next = 1;
  for (const row of result.rows) {
    const numPart = String(row.contact_id).replace(/^\D+/g, '');
    const n = parseInt(numPart, 10);
    if (!isNaN(n) && n >= next) next = n + 1;
  }

  let candidate = `${prefix}${String(next).padStart(4, '0')}`;
  while (true) {
    const exists = await pool.query(
      `SELECT 1 FROM contacts WHERE contact_id = $1 LIMIT 1`,
      [candidate]
    );
    if (exists.rows.length === 0) break;
    next += 1;
    candidate = `${prefix}${String(next).padStart(4, '0')}`;
  }
  return candidate;
};

// ── Fetch all contacts (filterable) ──────────────────────────────────────────
const fetchAllContacts = async (industryId, filters = {}) => {
  await ensureContactSchema();
  const {
    contactType = '', search = '', mobile = '', city = '', payTerm = '',
    customerGroupId = '', dateFrom = '', dateTo = '',
    limit = 25, offset = 0,
  } = filters;

  const normalizedType = normalizeType(contactType);

  let query = `
    SELECT c.*, cg.name AS customer_group_name
    FROM contacts c
    LEFT JOIN customer_groups cg ON cg.id = c.customer_group_id
    WHERE c.industry_id = $1
  `;
  const params = [industryId];

  if (normalizedType) {
    params.push(normalizedType);
    query += ` AND (c.contact_type = $${params.length} OR c.contact_type = 'Both')`;
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    query += ` AND (
      LOWER(c.contact_name) LIKE LOWER($${n}) OR
      LOWER(c.business_name) LIKE LOWER($${n}) OR
      LOWER(c.email) LIKE LOWER($${n}) OR
      c.phone LIKE $${n} OR
      LOWER(c.contact_id) LIKE LOWER($${n})
    )`;
  }
  if (mobile) {
    params.push(`%${mobile}%`);
    query += ` AND c.phone LIKE $${params.length}`;
  }
  if (city) {
    params.push(`%${city}%`);
    query += ` AND (LOWER(c.city) LIKE LOWER($${params.length}) OR LOWER(c.address) LIKE LOWER($${params.length}))`;
  }
  if (payTerm) {
    params.push(payTerm);
    query += ` AND c.pay_term = $${params.length}`;
  }
  if (customerGroupId) {
    params.push(customerGroupId);
    query += ` AND c.customer_group_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    query += ` AND c.created_at >= $${params.length}`;
  }
  if (dateTo) {
    params.push(dateTo + ' 23:59:59');
    query += ` AND c.created_at <= $${params.length}`;
  }

  const countQuery = query.replace(
    /SELECT c\.\*, cg\.name AS customer_group_name/,
    'SELECT COUNT(*)'
  );
  const countResult = await pool.query(countQuery, params);
  const total = parseInt(countResult.rows[0].count, 10);

  query += ` ORDER BY c.created_at DESC`;
  params.push(limit);
  query += ` LIMIT $${params.length}`;
  params.push(offset);
  query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  return { rows: result.rows, total };
};

// ── Fetch one contact + its persons ──────────────────────────────────────────
const fetchContactById = async (industryId, id) => {
  await ensureContactSchema();
  const result = await pool.query(
    `SELECT c.*, cg.name AS customer_group_name
     FROM contacts c
     LEFT JOIN customer_groups cg ON cg.id = c.customer_group_id
     WHERE c.id = $1 AND c.industry_id = $2`,
    [id, industryId]
  );
  if (result.rows.length === 0) return null;

  const personsResult = await pool.query(
    `SELECT id, name, mobile, email FROM contact_persons WHERE contact_id = $1`,
    [id]
  );

  const contact = { ...result.rows[0], persons: personsResult.rows };

  // total_purchase_due / total_purchase_return_due are stored columns on
  // `contacts` that nothing in the app ever updates (no purchase/payment/
  // return flow writes to them), so they silently stay at 0. Compute them
  // live from the purchases / purchase_returns tables instead, which do
  // keep their own payment_due accurate per-record.
  if (contact.contact_type === 'Suppliers' || contact.contact_type === 'Supplier') {
    const [purchaseDue, returnDue] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(payment_due), 0) AS total FROM purchases WHERE supplier_id = $1 AND industry_id = $2`,
        [id, industryId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(payment_due), 0) AS total FROM purchase_returns WHERE supplier_id = $1 AND industry_id = $2`,
        [id, industryId]
      ),
    ]);
    contact.total_purchase_due = parseFloat(purchaseDue.rows[0].total) || 0;
    contact.total_purchase_return_due = parseFloat(returnDue.rows[0].total) || 0;
  }

  return contact;
};

// ── Create contact ────────────────────────────────────────────────────────────
const createContact = async (industryId, data) => {
  await ensureContactSchema();
  if (!data.mobile || !String(data.mobile).trim()) {
    throw new Error('Mobile number is required');
  }

  const contactType = normalizeType(data.contactType || 'Suppliers');

  const contactId = data.contactId && String(data.contactId).trim()
    ? String(data.contactId).trim()
    : await generateContactId(industryId, contactType);

  const contactName = buildName(data);

  const result = await pool.query(
    `INSERT INTO contacts (
      contact_type, contact_id, is_individual, prefix,
      first_name, middle_name, last_name,
      business_name, contact_name,
      phone, alt_phone, landline, email, assigned_to,
      tax_number, pay_term, credit_limit, opening_balance, advance_balance,
      address, city, state, country, zip, customer_group_id, industry_id
    ) VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,
      $8,$9,
      $10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25,$26
    )
    RETURNING *`,
    [
      contactType,
      contactId,
      data.individual !== false,
      data.prefix || null,
      data.firstName || null,
      data.middleName || null,
      data.lastName || null,
      data.businessName || null,
      contactName,
      String(data.mobile).trim(),
      data.altPhone || null,
      data.landline || null,
      data.email || null,
      data.assignedTo || null,
      data.taxNumber || null,
      data.payTerm || null,
      parseFloat(data.creditLimit) || 0,
      parseFloat(data.openingBalance) || 0,
      0,
      data.address || null,
      data.city || null,
      data.state || null,
      data.country || null,
      data.zip || null,
      data.customerGroupId || null,
      industryId,
    ]
  );

  const contact = result.rows[0];

  if (Array.isArray(data.persons)) {
    for (const p of data.persons) {
      if (p.name || p.mobile || p.email) {
        await pool.query(
          `INSERT INTO contact_persons (contact_id, name, mobile, email) VALUES ($1,$2,$3,$4)`,
          [contact.id, p.name || null, p.mobile || null, p.email || null]
        );
      }
    }
  }

  return contact;
};

// ── Update contact ────────────────────────────────────────────────────────────
const updateContact = async (industryId, id, data) => {
  await ensureContactSchema();
  const existing = await fetchContactById(industryId, id);
  if (!existing) throw new Error('Contact not found');

  const merged = {
    is_individual: existing.is_individual,
    prefix: existing.prefix,
    first_name: existing.first_name,
    middle_name: existing.middle_name,
    last_name: existing.last_name,
    business_name: existing.business_name,
    mobile: existing.phone,
    ...data,
  };
  const contactName = buildName(merged);

  const result = await pool.query(
    `UPDATE contacts SET
      contact_type      = COALESCE($1,  contact_type),
      is_individual     = COALESCE($2,  is_individual),
      prefix            = COALESCE($3,  prefix),
      first_name        = COALESCE($4,  first_name),
      middle_name       = COALESCE($5,  middle_name),
      last_name         = COALESCE($6,  last_name),
      business_name     = COALESCE($7,  business_name),
      contact_name      = $8,
      phone             = COALESCE($9,  phone),
      alt_phone         = COALESCE($10, alt_phone),
      landline          = COALESCE($11, landline),
      email             = COALESCE($12, email),
      assigned_to       = COALESCE($13, assigned_to),
      tax_number        = COALESCE($14, tax_number),
      pay_term          = COALESCE($15, pay_term),
      credit_limit      = COALESCE($16, credit_limit),
      opening_balance   = COALESCE($17, opening_balance),
      address           = COALESCE($18, address),
      city              = COALESCE($19, city),
      state             = COALESCE($20, state),
      country           = COALESCE($21, country),
      zip               = COALESCE($22, zip),
      customer_group_id = COALESCE($23, customer_group_id),
      updated_at        = CURRENT_TIMESTAMP
     WHERE id = $24 AND industry_id = $25
     RETURNING *`,
    [
      data.contactType ? normalizeType(data.contactType) : null,
      data.individual !== undefined ? data.individual : null,
      data.prefix     || null,
      data.firstName  || null,
      data.middleName || null,
      data.lastName   || null,
      data.businessName || null,
      contactName,
      data.mobile || data.phone || null,
      data.altPhone   || null,
      data.landline   || null,
      data.email      || null,
      data.assignedTo || null,
      data.taxNumber  || null,
      data.payTerm    || null,
      data.creditLimit    !== undefined ? parseFloat(data.creditLimit)    : null,
      data.openingBalance !== undefined ? parseFloat(data.openingBalance) : null,
      data.address  || null,
      data.city     || null,
      data.state    || null,
      data.country  || null,
      data.zip      || null,
      data.customerGroupId || null,
      id,
      industryId,
    ]
  );

  if (Array.isArray(data.persons)) {
    await pool.query(`DELETE FROM contact_persons WHERE contact_id = $1`, [id]);
    for (const p of data.persons) {
      if (p.name || p.mobile || p.email) {
        await pool.query(
          `INSERT INTO contact_persons (contact_id, name, mobile, email) VALUES ($1,$2,$3,$4)`,
          [id, p.name || null, p.mobile || null, p.email || null]
        );
      }
    }
  }

  return result.rows[0];
};

// ── Delete contact ────────────────────────────────────────────────────────────
const deleteContact = async (industryId, id) => {
  const result = await pool.query(
    `DELETE FROM contacts WHERE id = $1 AND industry_id = $2 RETURNING id, contact_name, contact_id`,
    [id, industryId]
  );
  if (result.rows.length === 0) throw new Error('Contact not found');
  return result.rows[0];
};

// ── Dashboard stats ───────────────────────────────────────────────────────────
const getContactStats = async (industryId) => {
  const [suppliers, customers, purchaseDue, groups] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM contacts WHERE contact_type IN ('Suppliers','Both') AND industry_id = $1`, [industryId]),
    pool.query(`SELECT COUNT(*) FROM contacts WHERE contact_type IN ('Customers','Both') AND industry_id = $1`, [industryId]),
    pool.query(`SELECT COALESCE(SUM(total_purchase_due),0) AS total FROM contacts WHERE industry_id = $1`, [industryId]),
    pool.query(`SELECT COUNT(*) FROM customer_groups WHERE industry_id = $1`, [industryId]),
  ]);

  return {
    totalSuppliers:      parseInt(suppliers.rows[0].count, 10),
    totalCustomers:      parseInt(customers.rows[0].count, 10),
    totalPurchaseDue:    parseFloat(purchaseDue.rows[0].total) || 0,
    totalCustomerGroups: parseInt(groups.rows[0].count, 10),
  };
};

// ── Bulk import contacts ──────────────────────────────────────────────────────
const bulkImportContacts = async (industryId, rows) => {
  const created = [];
  const errors  = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      if (!r.mobile) throw new Error('Mobile is required');
      const typeMap = { '1': 'Customers', '2': 'Suppliers', '3': 'Both' };
      const rawType = String(r.contactType || '').trim();
      const contactType = typeMap[rawType] || normalizeType(rawType) || 'Suppliers';
      console.log(`Row ${i + 1}: rawType="${rawType}" → contactType="${contactType}"`);

      const contact = await createContact(industryId, {
        contactType,
        individual: !r.businessName,
        prefix: r.prefix,
        firstName: r.firstName,
        middleName: r.middleName,
        lastName: r.lastName,
        businessName: r.businessName,
        taxNumber: r.taxNumber,
        email: r.email,
        mobile: r.mobile,
        altPhone: r.altPhone,
        city: r.city,
        state: r.state,
        country: r.country,
        address: r.addressLine1,
        zip: r.zip,
        contactId: r.contactId,
        payTerm: r.payTermNumber ? `${r.payTermNumber} ${r.payTermType || 'days'}` : '',
        openingBalance: r.openingBalance,
      });
      created.push(contact);
    } catch (err) {
      errors.push({ row: i + 1, error: err.message });
    }
  }

  return { created: created.length, failed: errors.length, errors };
};

// ── Customer Groups CRUD ──────────────────────────────────────────────────────
const fetchAllGroups = async (industryId) => {
  await ensureContactSchema();
  const result = await pool.query(
    `SELECT cg.*, spg.name AS selling_price_group_name
     FROM customer_groups cg
     LEFT JOIN selling_price_groups spg ON spg.id = cg.selling_price_group_id
     WHERE cg.industry_id = $1
     ORDER BY cg.name`,
    [industryId]
  );
  return result.rows;
};

const createGroup = async (industryId, data) => {
  await ensureContactSchema();
  if (!data.name || !data.name.trim()) throw new Error('Customer Group Name is required');
  try {
    const result = await pool.query(
      `INSERT INTO customer_groups (name, selling_price_group_id, description, industry_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [
        data.name.trim(),
        data.sellingPriceGroupId || null,
        data.description || null,
        industryId,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') throw new Error('A Customer Group with this name already exists');
    throw err;
  }
};

const updateGroup = async (industryId, id, data) => {
  await ensureContactSchema();
  if (!data.name || !data.name.trim()) throw new Error('Customer Group Name is required');
  try {
    const result = await pool.query(
      `UPDATE customer_groups SET
        name = $1, selling_price_group_id = $2, description = $3
       WHERE id = $4 AND industry_id = $5 RETURNING *`,
      [
        data.name.trim(),
        data.sellingPriceGroupId || null,
        data.description || null,
        id,
        industryId,
      ]
    );
    if (result.rows.length === 0) throw new Error('Group not found');
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') throw new Error('A Customer Group with this name already exists');
    throw err;
  }
};

// ── Resolve a customer's linked Selling Price Group ──────────────────────────
const fetchCustomerPricingInfo = async (industryId, contactId) => {
  const result = await pool.query(
    `SELECT
       c.id                       AS contact_id,
       c.customer_group_id,
       cg.name                    AS customer_group_name,
       cg.selling_price_group_id,
       spg.name                   AS selling_price_group_name
     FROM contacts c
     LEFT JOIN customer_groups cg   ON cg.id  = c.customer_group_id
     LEFT JOIN selling_price_groups spg ON spg.id = cg.selling_price_group_id
     WHERE c.id = $1 AND c.industry_id = $2`,
    [contactId, industryId]
  );
  return result.rows[0] || null;
};

const deleteGroup = async (industryId, id) => {
  const result = await pool.query(
    `DELETE FROM customer_groups WHERE id = $1 AND industry_id = $2 RETURNING id, name`,
    [id, industryId]
  );
  if (result.rows.length === 0) throw new Error('Group not found');
  return result.rows[0];
};

// ── Find or create a supplier by name/code — used by Product Import ─────────
// industryId is OPTIONAL and appended last to stay backward-compatible with
// existing callers (e.g. Product Import) that don't pass one — in that case
// behavior is unchanged from before Contacts was industry-isolated.
const findOrCreateSupplierByName = async (nameOrCode, client = pool, industryId = null) => {
  const ref = String(nameOrCode || '').trim();
  if (!ref) { console.log('⚠️ findOrCreateSupplierByName: empty ref'); return null; }
  console.log('🔎 findOrCreateSupplierByName called with:', ref);

  const scopeClause = industryId ? ` AND industry_id = $2` : '';
  const scopeParams = industryId ? [ref, industryId] : [ref];
  const existing = await client.query(
    `SELECT id FROM contacts
     WHERE contact_type IN ('Suppliers','Both')
       AND (LOWER(contact_name) = LOWER($1) OR LOWER(contact_id) = LOWER($1))
       ${scopeClause}
     LIMIT 1`,
    scopeParams
  );
  if (existing.rows[0]) return existing.rows[0].id;
  try {
    const contactId = await generateContactId(industryId, 'Suppliers');
    const created = await client.query(
      `INSERT INTO contacts (
        contact_type, contact_id, is_individual, business_name, contact_name, phone, industry_id
      ) VALUES ('Suppliers', $1, false, $2, $2, '', $3)
      RETURNING id`,
      [contactId, ref, industryId]
    );
    console.log('✅ Supplier created:', ref, '→ id', created.rows[0].id);
    return created.rows[0].id;
  } catch (err) {
    console.error('❌ findOrCreateSupplierByName failed for', ref, ':', err.message);
    throw err;
  }
};

module.exports = {
  ensureContactSchema,
  fetchAllContacts,
  fetchContactById,
  createContact,
  updateContact,
  deleteContact,
  fetchCustomerPricingInfo,
  getContactStats,
  bulkImportContacts,
  fetchAllGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  adjustAdvanceBalance,
  findOrCreateSupplierByName,
};  