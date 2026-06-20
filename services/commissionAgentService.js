/**
 * ====================================================
 * SALES COMMISSION AGENT SERVICE
 * Business logic & database operations
 * ====================================================
 */

const pool = require('../config/database');

// ── Fetch all agents with filters ──
const fetchAllAgents = async (filters = {}) => {
  const { search = '', status = '', region = '', limit = 25, offset = 0 } = filters;

  let query = `
    SELECT 
      id, name, email, phone, commission_type, commission_rate,
      status, customers_assigned, region, join_date, notes,
      created_at, updated_at
    FROM sales_commission_agents
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      LOWER(name) LIKE LOWER($${params.length})
      OR LOWER(email) LIKE LOWER($${params.length})
      OR LOWER(region) LIKE LOWER($${params.length})
    )`;
  }

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  if (region) {
    params.push(region);
    query += ` AND LOWER(region) = LOWER($${params.length})`;
  }

  query += ` ORDER BY created_at DESC`;

  // Add pagination
  if (limit) {
    params.push(limit);
    query += ` LIMIT $${params.length}`;
  }
  if (offset) {
    params.push(offset);
    query += ` OFFSET $${params.length}`;
  }

  const result = await pool.query(query, params);
  return result.rows;
};

// ── Get total count of agents ──
const countAgents = async (filters = {}) => {
  const { search = '', status = '', region = '' } = filters;

  let query = 'SELECT COUNT(*) as count FROM sales_commission_agents WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      LOWER(name) LIKE LOWER($${params.length})
      OR LOWER(email) LIKE LOWER($${params.length})
      OR LOWER(region) LIKE LOWER($${params.length})
    )`;
  }

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  if (region) {
    params.push(region);
    query += ` AND LOWER(region) = LOWER($${params.length})`;
  }

  const result = await pool.query(query, params);
  return parseInt(result.rows[0].count);
};

// ── Fetch agent by ID ──
const fetchAgentById = async (id) => {
  const result = await pool.query(
    `SELECT id, name, email, phone, commission_type, commission_rate,
            status, customers_assigned, region, join_date, notes,
            created_at, updated_at
     FROM sales_commission_agents WHERE id = $1`,
    [id]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
};

// ── Check if email already exists ──
const emailExists = async (email, excludeId = null) => {
  let query = 'SELECT id FROM sales_commission_agents WHERE LOWER(email) = LOWER($1)';
  const params = [email];

  if (excludeId) {
    query += ` AND id != $2`;
    params.push(excludeId);
  }

  const result = await pool.query(query, params);
  return result.rows.length > 0;
};

// ── Create new agent ──
const createNewAgent = async (agentData) => {
  const {
    name, email, phone, commission_type, commission_rate,
    status, customers, region, join_date, notes
  } = agentData;

  // Check if email exists
  if (await emailExists(email)) {
    throw new Error('Email already exists');
  }

  const result = await pool.query(
    `INSERT INTO sales_commission_agents 
     (name, email, phone, commission_type, commission_rate, status, customers_assigned, region, join_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, name, email, phone, commission_type, commission_rate, status, 
               customers_assigned, region, join_date, notes, created_at`,
    [
      name.trim(),
      email.toLowerCase().trim(),
      phone || null,
      commission_type,
      parseFloat(commission_rate),
      status || 'Active',
      parseInt(customers) || 0,
      region || null,
      join_date || null,
      notes || null
    ]
  );

  return result.rows[0];
};

// ── Update existing agent ──
const updateExistingAgent = async (id, agentData) => {
  const {
    name, email, phone, commission_type, commission_rate,
    status, customers, region, join_date, notes
  } = agentData;

  // Check if agent exists
  const agent = await fetchAgentById(id);
  if (!agent) {
    throw new Error('Agent not found');
  }

  // Check email uniqueness
  if (email && await emailExists(email, id)) {
    throw new Error('Email already in use');
  }

  const result = await pool.query(
    `UPDATE sales_commission_agents
     SET name = COALESCE($1, name),
         email = COALESCE($2, email),
         phone = COALESCE($3, phone),
         commission_type = COALESCE($4, commission_type),
         commission_rate = COALESCE($5, commission_rate),
         status = COALESCE($6, status),
         customers_assigned = COALESCE($7, customers_assigned),
         region = COALESCE($8, region),
         join_date = COALESCE($9, join_date),
         notes = COALESCE($10, notes),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $11
     RETURNING id, name, email, phone, commission_type, commission_rate, status,
               customers_assigned, region, join_date, notes, updated_at`,
    [
      name ? name.trim() : null,
      email ? email.toLowerCase().trim() : null,
      phone || null,
      commission_type || null,
      commission_rate !== undefined && commission_rate !== null ? parseFloat(commission_rate) : null,
      status || null,
      customers !== undefined && customers !== null ? parseInt(customers) : null,
      region || null,
      join_date || null,
      notes || null,
      id
    ]
  );

  return result.rows[0];
};

// ── Delete agent ──
const deleteExistingAgent = async (id) => {
  const result = await pool.query(
    'DELETE FROM sales_commission_agents WHERE id = $1 RETURNING id, name, email',
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error('Agent not found');
  }

  return result.rows[0];
};

// ── Get total sales for agent (current month) ──
const getAgentMonthlySales = async (agentId) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const monthStart = startOfMonth.toISOString().split('T')[0];

  const result = await pool.query(
    `SELECT COALESCE(SUM(sale_amount), 0) as total, COUNT(*) as transaction_count
     FROM sales_transactions
     WHERE agent_id = $1 AND sale_date >= $2 AND status = 'Completed'`,
    [agentId, monthStart]
  );

  return {
    totalSales: parseFloat(result.rows[0].total) || 0,
    transactionCount: parseInt(result.rows[0].transaction_count) || 0
  };
};

// ── Calculate commission based on type ──
const calculateCommission = async (agentId, commissionType, commissionRate) => {
  const monthlySales = await getAgentMonthlySales(agentId);
  const { totalSales } = monthlySales;

  let commission = 0;

  switch (commissionType.toLowerCase()) {
    case 'percentage':
      commission = (totalSales * commissionRate) / 100;
      break;
    case 'fixed':
      commission = commissionRate; // Fixed monthly amount
      break;
    case 'tiered':
      // Implement tiered logic based on brackets
      // Example brackets:
      // 0 - 100k: 2%
      // 100k - 500k: 4%
      // 500k+: 6%
      if (totalSales <= 100000) {
        commission = (totalSales * 2) / 100;
      } else if (totalSales <= 500000) {
        commission = (totalSales * 4) / 100;
      } else {
        commission = (totalSales * 6) / 100;
      }
      break;
    default:
      commission = 0;
  }

  return Math.round(commission);
};

// ── Get dashboard statistics ──
const getDashboardStatistics = async () => {
  // Total agents
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM sales_commission_agents');
  const totalAgents = parseInt(totalResult.rows[0].count);

  // Active agents
  const activeResult = await pool.query(
    "SELECT COUNT(*) as count FROM sales_commission_agents WHERE status = 'Active'"
  );
  const activeAgents = parseInt(activeResult.rows[0].count);

  // Total sales this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const monthStart = startOfMonth.toISOString().split('T')[0];

  const salesResult = await pool.query(
    `SELECT COALESCE(SUM(sale_amount), 0) as total
     FROM sales_transactions
     WHERE sale_date >= $1 AND status = 'Completed'`,
    [monthStart]
  );
  const totalSalesThisMonth = parseFloat(salesResult.rows[0].total) || 0;

  // Average commission rate
  const avgResult = await pool.query(
    'SELECT AVG(commission_rate) as avg FROM sales_commission_agents'
  );
  const avgCommissionRate = parseFloat(avgResult.rows[0].avg || 0);

  return {
    totalAgents,
    activeAgents,
    totalSalesThisMonth: Math.round(totalSalesThisMonth),
    averageCommissionRate: parseFloat(avgCommissionRate.toFixed(1))
  };
};

// ── Get all regions (for filter dropdown) ──
const getAllRegions = async () => {
  const result = await pool.query(
    `SELECT DISTINCT region FROM sales_commission_agents WHERE region IS NOT NULL ORDER BY region`
  );
  return result.rows.map(r => r.region);
};

// ── Validate agent data ──
const validateAgentData = (data) => {
  const errors = [];

  if (!data.name || !data.name.trim()) {
    errors.push('Agent name is required');
  }

  if (!data.email || !data.email.trim()) {
    errors.push('Email is required');
  } else if (!isValidEmail(data.email)) {
    errors.push('Invalid email format');
  }

  if (!data.commission_type || !['Percentage', 'Fixed', 'Tiered'].includes(data.commission_type)) {
    errors.push('Invalid commission type');
  }

  if (data.commission_rate === undefined || data.commission_rate === null) {
    errors.push('Commission rate is required');
  } else if (parseFloat(data.commission_rate) < 0) {
    errors.push('Commission rate must be >= 0');
  } else if (data.commission_type === 'Percentage' && parseFloat(data.commission_rate) > 100) {
    errors.push('Percentage commission cannot exceed 100%');
  }

  if (data.status && !['Active', 'Inactive', 'Suspended'].includes(data.status)) {
    errors.push('Invalid status');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// ── Helper: Validate email format ──
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

module.exports = {
  fetchAllAgents,
  countAgents,
  fetchAgentById,
  emailExists,
  createNewAgent,
  updateExistingAgent,
  deleteExistingAgent,
  getAgentMonthlySales,
  calculateCommission,
  getDashboardStatistics,
  getAllRegions,
  validateAgentData
};