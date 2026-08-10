const express = require('express');
const router = express.Router();

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

// ═══════════════════════════════════════════════════════════════════════════
// LEADS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/leads', getLeads);
router.get('/leads/:id', getLeadById);
router.post('/leads', createLead);
router.put('/leads/:id', updateLead);
router.delete('/leads/:id', deleteLead);
router.patch('/leads/:id/convert', convertLead);

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/followups', getFollowups);
router.post('/followups', createFollowup);
router.put('/followups/:id', updateFollowup);
router.delete('/followups/:id', deleteFollowup);

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGNS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/campaigns', getCampaigns);
router.post('/campaigns', createCampaign);
router.put('/campaigns/:id', updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);

// ═══════════════════════════════════════════════════════════════════════════
// PROPOSALS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/proposals', getProposals);
router.post('/proposals', createProposal);
router.put('/proposals/:id', updateProposal);
router.post('/proposals/:id/send', sendProposal);
router.delete('/proposals/:id', deleteProposal);

// ═══════════════════════════════════════════════════════════════════════════
// CONTACTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/contacts', getContacts);
router.post('/contacts', createContact);
router.put('/contacts/:id', updateContact);
router.delete('/contacts/:id', deleteContact);

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/templates', getTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS ROUTE
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dashboard/stats', getDashboardStats);

module.exports = router;