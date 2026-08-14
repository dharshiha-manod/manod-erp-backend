const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permission');

const {
  // leads
  getLeads, getLeadById, createLead, updateLead, deleteLead, convertLead,
  // followups
  getFollowups, createFollowup, updateFollowup, deleteFollowup,
  // campaigns
  getCampaigns, createCampaign, updateCampaign, deleteCampaign,
  // proposals
  getProposals, createProposal, updateProposal, deleteProposal, sendProposal,
  // templates
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  // contacts
  getContacts, createContact, updateContact, deleteContact,
  // dashboard
  getDashboardStats,
} = require('../controllers/crmController');

// Every CRM route requires login (req.user is used by the permission checks below)
router.use(authenticateToken);

const anyLeads     = requireAnyPermission([['Crm', 'Access all leads'], ['Crm', 'Access own leads']]);
const anyFollowups = requireAnyPermission([['Crm', 'Access all follow up'], ['Crm', 'Access own follow up']]);
const anyCampaigns = requireAnyPermission([['Crm', 'Access all campaigns'], ['Crm', 'Access own campaigns']]);
const anyProposal  = requirePermission('Crm', 'Access proposal');
const anyContacts  = requirePermission('Crm', 'Access contact login');

// ═══════════════════════════════════════════════════════════════════════════
// LEADS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/leads', anyLeads, getLeads);
router.get('/leads/:id', anyLeads, getLeadById);
router.post('/leads', anyLeads, createLead);
router.put('/leads/:id', anyLeads, updateLead);
router.delete('/leads/:id', anyLeads, deleteLead);
router.patch('/leads/:id/convert', anyLeads, convertLead);

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/followups', anyFollowups, getFollowups);
router.post('/followups', anyFollowups, createFollowup);
router.put('/followups/:id', anyFollowups, updateFollowup);
router.delete('/followups/:id', anyFollowups, deleteFollowup);

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGNS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/campaigns', anyCampaigns, getCampaigns);
router.post('/campaigns', anyCampaigns, createCampaign);
router.put('/campaigns/:id', anyCampaigns, updateCampaign);
router.delete('/campaigns/:id', anyCampaigns, deleteCampaign);

// ═══════════════════════════════════════════════════════════════════════════
// PROPOSALS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/proposals', anyProposal, getProposals);
router.post('/proposals', anyProposal, createProposal);
router.put('/proposals/:id', anyProposal, updateProposal);
router.post('/proposals/:id/send', anyProposal, sendProposal);
router.delete('/proposals/:id', anyProposal, deleteProposal);

// ═══════════════════════════════════════════════════════════════════════════
// CONTACTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/contacts', anyContacts, getContacts);
router.post('/contacts', anyContacts, createContact);
router.put('/contacts/:id', anyContacts, updateContact);
router.delete('/contacts/:id', anyContacts, deleteContact);

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES ROUTES (uses the same "Access proposal" permission as Proposals,
// since there's no separate seeded permission for templates yet)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/templates', anyProposal, getTemplates);
router.post('/templates', anyProposal, createTemplate);
router.put('/templates/:id', anyProposal, updateTemplate);
router.delete('/templates/:id', anyProposal, deleteTemplate);

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS ROUTE — any CRM permission is enough to see the summary
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dashboard/stats', requireAnyPermission([
  ['Crm', 'Access all leads'], ['Crm', 'Access own leads'],
  ['Crm', 'Access all campaigns'], ['Crm', 'Access own campaigns'],
]), getDashboardStats);

module.exports = router;