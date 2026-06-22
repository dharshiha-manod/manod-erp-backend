/**
 * ====================================================
 * CONTACT SERVICE  (FIXED)
 * Fixes:
 *  1. contact_name NOT NULL violation — INSERT now uses `contact_name` column
 *     and buildName never returns '—' (returns first_name or mobile as last resort)
 *  2. contactType filter — handles both 'Suppliers'/'Customers' AND 'supplier'/'customer'
 *  3. updateContact — also writes contact_name on UPDATE
 * ====================================================
 */

const pool = require('../config/database');

// ── Helper: build full display name ──────────────────────────────────────────
// FIXED: never returns '—'; always returns a non-empty string so NOT NULL is satisfied
const buildName = (data) => {
  const isIndividual = data.is_individual !== false && data.is_individual !== 'false';

  if (!isIndividual) {
    // Business contact — use business_name
    const biz = (data.businessName || data.business_name || '').trim();
    if (biz) return biz;
  }

  // Individual (or business with no name yet) — combine name parts
  const parts = [
    data.prefix,
    data.firstName || data.first_name,
    data.middleName || data.middle_name,
    data.lastName || data.last_name,
  ].map((s) => (s || '').trim()).filter(Boolean);

  if (parts.length) return parts.join(' ');

  // Last resort — business name or mobile (never null)
  return (
    (data.businessName || data.business_name || '').trim() ||
    (data.mobile || '').trim() ||
    'Unknown'
  );
};

// ── Helper: normalize contactType param ──────────────────────────────────────
// Accepts 'Customers', 'customer', 'Suppliers', 'supplier', 'Both', 'both'
const normalizeType = (raw = '') => {
  const t = raw.trim().toLowerCase();
  if (t === 'customers' || t === 'customer') return 'Customers';
  if (t === 'suppliers' || t === 'supplier') return 'Suppliers';
  if (t === 'both') return 'Both';
  return raw.trim(); // pass through unknown values
};

// ── Helper: auto-generate contact_id ─────────────────────────────────────────
const generateContactId = async (contactType) => {
  const prefix = normalizeType(contactType) === 'Customers' ? 'CO' : 'SUP';
  const result = await pool.query(
    `SELECT contact_id FROM contacts
     WHERE contact_id LIKE $1
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].contact_id.replace(prefix, ''), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
};

// ── Fetch all contacts (filterable) ──────────────────────────────────────────
const fetchAllContacts = async (filters = {}) => {
  const {
    contactType = '', search = '', mobile = '', city = '', payTerm = '',
    customerGroupId = '', dateFrom = '', dateTo = '',
    limit = 25, offset = 0,
  } = filters;

  // FIXED: normalize so 'customer' and 'Customers' both work
  const normalizedType = normalizeType(contactType);

  let query = `
    SELECT c.*, cg.name AS customer_group_name
    FROM contacts c
    LEFT JOIN customer_groups cg ON cg.id = c.customer_group_id
    WHERE 1=1
  `;
  const params = [];

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
      c.mobile LIKE $${n} OR
      LOWER(c.contact_id) LIKE LOWER($${n})
    )`;
  }
  if (mobile) {
    params.push(`%${mobile}%`);
    query += ` AND c.mobile LIKE $${params.length}`;
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
    params.push(dateTo + ' 23:59:59'); // include full day
    query += ` AND c.created_at <= $${params.length}`;
  }

  // Count
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
const fetchContactById = async (id) => {
  const result = await pool.query(
    `SELECT c.*, cg.name AS customer_group_name
     FROM contacts c
     LEFT JOIN customer_groups cg ON cg.id = c.customer_group_id
     WHERE c.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;

  const personsResult = await pool.query(
    `SELECT id, name, mobile, email FROM contact_persons WHERE contact_id = $1`,
    [id]
  );
  return { ...result.rows[0], persons: personsResult.rows };
};

// ── Create contact ────────────────────────────────────────────────────────────
// FIXED: INSERT uses `contact_name` column (matches DB schema) instead of `name`
const createContact = async (data) => {
  if (!data.mobile || !String(data.mobile).trim()) {
    throw new Error('Mobile number is required');
  }

  const contactType = normalizeType(data.contactType || 'Suppliers');

  const contactId = data.contactId && String(data.contactId).trim()
    ? String(data.contactId).trim()
    : await generateContactId(contactType);

  // FIXED: buildName never returns null/'—'
  const contactName = buildName(data);

  const result = await pool.query(
    `INSERT INTO contacts (
      contact_type, contact_id, is_individual, prefix,
      first_name, middle_name, last_name,
      business_name, contact_name,
      mobile, alt_phone, landline, email, assigned_to,
      tax_number, pay_term, credit_limit, opening_balance, advance_balance,
      address, city, state, country, zip, customer_group_id
    ) VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,
      $8,$9,
      $10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25
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
      contactName,                              // FIXED: was 'name', now 'contact_name'
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
    ]
  );

  const contact = result.rows[0];

  // Insert contact persons
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
// FIXED: also updates contact_name column
const updateContact = async (id, data) => {
  const existing = await fetchContactById(id);
  if (!existing) throw new Error('Contact not found');

  // Merge existing with incoming so buildName has all fields
  const merged = {
    is_individual: existing.is_individual,
    prefix: existing.prefix,
    first_name: existing.first_name,
    middle_name: existing.middle_name,
    last_name: existing.last_name,
    business_name: existing.business_name,
    mobile: existing.mobile,
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
      mobile            = COALESCE($9,  mobile),
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
     WHERE id = $24
     RETURNING *`,
    [
      data.contactType ? normalizeType(data.contactType) : null,
      data.individual !== undefined ? data.individual : null,
      data.prefix     || null,
      data.firstName  || null,
      data.middleName || null,
      data.lastName   || null,
      data.businessName || null,
      contactName,                              // FIXED: always non-null
      data.mobile     || null,
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
    ]
  );

  // Replace persons if provided
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
const deleteContact = async (id) => {
  const result = await pool.query(
    `DELETE FROM contacts WHERE id = $1 RETURNING id, contact_name, contact_id`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Contact not found');
  return result.rows[0];
};

// ── Dashboard stats ───────────────────────────────────────────────────────────
const getContactStats = async () => {
  const [suppliers, customers, purchaseDue, groups] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM contacts WHERE contact_type IN ('Suppliers','Both')`),
    pool.query(`SELECT COUNT(*) FROM contacts WHERE contact_type IN ('Customers','Both')`),
    pool.query(`SELECT COALESCE(SUM(total_purchase_due),0) AS total FROM contacts`),
    pool.query(`SELECT COUNT(*) FROM customer_groups`),
  ]);

  return {
    totalSuppliers:      parseInt(suppliers.rows[0].count, 10),
    totalCustomers:      parseInt(customers.rows[0].count, 10),
    totalPurchaseDue:    parseFloat(purchaseDue.rows[0].total) || 0,
    totalCustomerGroups: parseInt(groups.rows[0].count, 10),
  };
};

// ── Bulk import contacts ──────────────────────────────────────────────────────
const bulkImportContacts = async (rows) => {
  const created = [];
  const errors  = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      if (!r.mobile) throw new Error('Mobile is required');
      const typeMap = { '1': 'Customers', '2': 'Suppliers', '3': 'Both' };
      const contactType = typeMap[r.contactType] || normalizeType(r.contactType) || 'Suppliers';

      const contact = await createContact({
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
const fetchAllGroups = async () => {
  const result = await pool.query(`SELECT * FROM customer_groups ORDER BY name`);
  return result.rows;
};

const createGroup = async (data) => {
  if (!data.name || !data.name.trim()) throw new Error('Customer Group Name is required');
  const result = await pool.query(
    `INSERT INTO customer_groups (name, price_calc_type, calc_percent, selling_price_group)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [
      data.name.trim(),
      data.priceCalcType || 'Percentage',
      parseFloat(data.calcPercent) || 0,
      data.sellingPriceGroup || null,
    ]
  );
  return result.rows[0];
};

const deleteGroup = async (id) => {
  const result = await pool.query(
    `DELETE FROM customer_groups WHERE id = $1 RETURNING id, name`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Group not found');
  return result.rows[0];
};

module.exports = {
  fetchAllContacts,
  fetchContactById,
  createContact,
  updateContact,
  deleteContact,
  getContactStats,
  bulkImportContacts,
  fetchAllGroups,
  createGroup,
  deleteGroup,
};