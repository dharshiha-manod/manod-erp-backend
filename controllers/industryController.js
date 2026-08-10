const industryService = require('../services/industryService');
const DEFAULT_BUSINESS_ID = 1;

exports.getIndustries = async (req, res) => {
  try {
    const industries = await industryService.listIndustries(DEFAULT_BUSINESS_ID);
    res.status(200).json({ success: true, data: industries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createIndustry = async (req, res) => {
  try {
    const industry = await industryService.createIndustry(DEFAULT_BUSINESS_ID, req.body);
    res.status(201).json({ success: true, message: 'Industry created successfully', data: industry });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateIndustry = async (req, res) => {
  try {
    const industry = await industryService.updateIndustry(DEFAULT_BUSINESS_ID, req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Industry updated successfully', data: industry });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteIndustry = async (req, res) => {
  try {
    const industry = await industryService.deleteIndustry(DEFAULT_BUSINESS_ID, req.params.id);
    res.status(200).json({ success: true, message: 'Industry archived successfully', data: industry });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.setActiveIndustry = async (req, res) => {
  try {
    const userId = req.user?.id;
    const industry = await industryService.setActiveIndustry(userId, DEFAULT_BUSINESS_ID, req.body.industry_id);
    res.status(200).json({ success: true, message: 'Active industry switched', data: industry });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};