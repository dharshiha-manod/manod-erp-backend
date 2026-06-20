/**
 * ====================================================
 * SALES COMMISSION AGENT CONTROLLER
 * Full CRUD operations + Dashboard stats
 * ====================================================
 */

const pool = require('../config/database');

// ── GET ALL AGENTS (with pagination & search) ──
const getAllAgents = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', status = '', region = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        id, name, email, phone, commission_type, commission_rate,
        status, customers_assigned AS customers, region, join_date, notes,
        created_at, updated_at
      FROM sales_commission_agents
      WHERE 1=1
    `;
    const params = [];

    // Search by name, email, or region
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (
        LOWER(name) LIKE LOWER($${params.length})
        OR LOWER(email) LIKE LOWER($${params.length})
        OR LOWER(region) LIKE LOWER($${params.length})
      )`;
    }

    // Filter by status
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    // Filter by region
    if (region) {
      params.push(region);
      query += ` AND LOWER(region) = LOWER($${params.length})`;
    }

    // Count total records
    const countQuery = query.replace(
      'SELECT id, name, email, phone, commission_type, commission_rate, status, customers_assigned AS customers, region, join_date, notes, created_at, updated_at FROM',
      'SELECT COUNT(*) FROM'
    );
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated data
    params.push(limit);
    params.push(offset);
    query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Calculate commission for each agent
    const agentsWithCommission = await Promise.all(
      result.rows.map(async (agent) => {
        const commission = await calculateAgentCommission(agent.id, agent.commission_type, agent.commission_rate);
        return {
          ...agent,
          salesThisMonth: commission.salesThisMonth,
          totalEarned: commission.totalEarned,
          commissionCalculated: true
        };
      })
    );

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      agents: agentsWithCommission
    });
  } catch (err) {
    console.error('❌ Get All Agents Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch agents' });
  }
};

// ── GET SINGLE AGENT ──
const getAgentById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, name, email, phone, commission_type, commission_rate,
              status, customers_assigned AS customers, region, join_date, notes,
              created_at, updated_at
       FROM sales_commission_agents WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Calculate commission
    const agent = result.rows[0];
    const commission = await calculateAgentCommission(agent.id, agent.commission_type, agent.commission_rate);

    res.status(200).json({
      success: true,
      agent: {
        ...agent,
        salesThisMonth: commission.salesThisMonth,
        totalEarned: commission.totalEarned,
        commissionCalculated: true
      }
    });
  } catch (err) {
    console.error('❌ Get Agent By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch agent' });
  }
};

// ── CREATE AGENT ──
const createAgent = async (req, res) => {
  try {
    const {
      name, email, phone, commission_type, commission_rate,
      status, customers, region, join_date, notes
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Agent name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    if (!commission_type || !['Percentage', 'Fixed', 'Tiered'].includes(commission_type)) {
      return res.status(400).json({ success: false, error: 'Invalid commission type' });
    }
    if (commission_rate === undefined || commission_rate === null || commission_rate < 0) {
      return res.status(400).json({ success: false, error: 'Commission rate must be >= 0' });
    }

    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM sales_commission_agents WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }

    const result = await pool.query(
      `INSERT INTO sales_commission_agents 
       (name, email, phone, commission_type, commission_rate, status, customers_assigned, region, join_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, email, phone, commission_type, commission_rate, status, 
                 customers_assigned AS customers, region, join_date, notes, created_at`,
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

    console.log('✅ Agent created:', result.rows[0].email);
    res.status(201).json({
      success: true,
      message: 'Agent created successfully',
      agent: { ...result.rows[0], salesThisMonth: 0, totalEarned: 0 }
    });
  } catch (err) {
    console.error('❌ Create Agent Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create agent' });
  }
};

// ── UPDATE AGENT ──
const updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, phone, commission_type, commission_rate,
      status, customers, region, join_date, notes
    } = req.body;

    // Check if agent exists
    const existing = await pool.query(
      'SELECT id FROM sales_commission_agents WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // If email is being updated, check for duplicates
    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM sales_commission_agents WHERE LOWER(email) = LOWER($1) AND id != $2',
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Email already in use' });
      }
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
                 customers_assigned AS customers, region, join_date, notes, updated_at`,
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

    console.log('✅ Agent updated:', result.rows[0].email);
    
    // Calculate commission for updated agent
    const agent = result.rows[0];
    const commission = await calculateAgentCommission(agent.id, agent.commission_type, agent.commission_rate);

    res.status(200).json({
      success: true,
      message: 'Agent updated successfully',
      agent: {
        ...agent,
        salesThisMonth: commission.salesThisMonth,
        totalEarned: commission.totalEarned
      }
    });
  } catch (err) {
    console.error('❌ Update Agent Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update agent' });
  }
};

// ── DELETE AGENT ──
const deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM sales_commission_agents WHERE id = $1 RETURNING id, name, email',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    console.log('✅ Agent deleted:', result.rows[0].email);
    res.status(200).json({
      success: true,
      message: 'Agent deleted successfully',
      agent: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Delete Agent Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete agent' });
  }
};

// ── GET DASHBOARD STATISTICS ──
const getDashboardStats = async (req, res) => {
  try {
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
    
    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(sale_amount), 0) as total
       FROM sales_transactions
       WHERE sale_date >= $1 AND status = 'Completed'`,
      [startOfMonth.toISOString().split('T')[0]]
    );
    const totalSalesThisMonth = parseFloat(salesResult.rows[0].total);

    // Average commission rate
    const avgResult = await pool.query(
      'SELECT AVG(commission_rate) as avg FROM sales_commission_agents'
    );
    const avgCommissionRate = parseFloat(avgResult.rows[0].avg || 0).toFixed(1);

    // Get all agents with calculated commissions
    const agentsResult = await pool.query(
      `SELECT id, commission_type, commission_rate
       FROM sales_commission_agents`
    );

    let totalEarnedByAllAgents = 0;
    for (const agent of agentsResult.rows) {
      const commission = await calculateAgentCommission(agent.id, agent.commission_type, agent.commission_rate);
      totalEarnedByAllAgents += commission.totalEarned;
    }

    res.status(200).json({
      success: true,
      stats: {
        totalAgents,
        activeAgents,
        totalSalesThisMonth: Math.round(totalSalesThisMonth),
        averageCommissionRate: parseFloat(avgCommissionRate),
        totalEarnedByAllAgents: Math.round(totalEarnedByAllAgents)
      }
    });
  } catch (err) {
    console.error('❌ Get Dashboard Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

// ── HELPER: Calculate commission for an agent ──
async function calculateAgentCommission(agentId, commissionType, commissionRate) {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const monthStart = startOfMonth.toISOString().split('T')[0];

    // Get all completed sales for this month
    const result = await pool.query(
      `SELECT COALESCE(SUM(sale_amount), 0) as total
       FROM sales_transactions
       WHERE agent_id = $1 AND sale_date >= $2 AND status = 'Completed'`,
      [agentId, monthStart]
    );

    const salesThisMonth = parseFloat(result.rows[0].total) || 0;
    let totalEarned = 0;

    if (commissionType === 'Percentage') {
      totalEarned = (salesThisMonth * commissionRate) / 100;
    } else if (commissionType === 'Fixed') {
      totalEarned = commissionRate; // Fixed monthly amount
    } else if (commissionType === 'Tiered') {
      // Tiered: implement based on your bracket logic
      // For now, using simple percentage as fallback
      totalEarned = (salesThisMonth * commissionRate) / 100;
    }

    return {
      salesThisMonth: Math.round(salesThisMonth),
      totalEarned: Math.round(totalEarned)
    };
  } catch (err) {
    console.error('Error calculating commission:', err.message);
    return { salesThisMonth: 0, totalEarned: 0 };
  }
}

// ── RECALCULATE COMMISSION FOR ALL AGENTS ──
const recalculateCommissions = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, commission_type, commission_rate FROM sales_commission_agents'
    );

    const updated = [];
    for (const agent of result.rows) {
      const commission = await calculateAgentCommission(agent.id, agent.commission_type, agent.commission_rate);
      updated.push({
        id: agent.id,
        ...commission
      });
    }

    console.log('✅ Commissions recalculated for all agents');
    res.status(200).json({
      success: true,
      message: 'Commissions recalculated successfully',
      data: updated
    });
  } catch (err) {
    console.error('❌ Recalculate Commissions Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to recalculate commissions' });
  }
};

module.exports = {
  getAllAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  getDashboardStats,
  recalculateCommissions
};