const express = require('express');
const Brand = require('../../models/Brand');
const OpenAIService = require('../../services/openaiService');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

// POST /api/brands/:brandId/preview
router.post('/', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const { contact = {}, systemPrompt } = req.body;

  // Use provided contact data or defaults
  const contactData = {
    first_name: contact.firstName || contact.first_name || 'Alex',
    last_name: contact.lastName || contact.last_name || 'Johnson',
    job_title: contact.jobTitle || contact.job_title || 'CTO',
    company_name: contact.companyName || contact.company_name || 'Acme Corp',
    industry: contact.industry || 'Software',
    technology_stack: contact.technologyStack || contact.technology_stack || [],
    country: contact.country || 'United States',
    company_description: contact.companyDescription || contact.company_description || '',
    company_size: contact.companySize || contact.company_size || '',
    headline: contact.headline || '',
    seniority_level: contact.seniorityLevel || contact.seniority_level || ''
  };

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  // Use provided systemPrompt or brand's default
  const prompt = systemPrompt || brand.openai?.systemPrompt;

  const result = await openai.generateEmail(contactData, brand, prompt);

  if (!result) {
    return res.status(500).json({ error: 'Failed to generate email preview' });
  }

  return res.json({
    subject: result.subject,
    body: result.body,
    tokens: result.tokens || null
  });
}));

// POST /api/brands/:brandId/preview/ab
router.post('/ab', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  if (!brand.abTest?.enabled) {
    return res.status(400).json({ error: 'A/B testing is not enabled for this brand' });
  }

  if (!brand.abTest?.promptA || !brand.abTest?.promptB) {
    return res.status(400).json({ error: 'Both Prompt A and Prompt B must be configured' });
  }

  const { contact = {} } = req.body;

  const contactData = {
    first_name: contact.firstName || contact.first_name || 'Alex',
    last_name: contact.lastName || contact.last_name || 'Johnson',
    job_title: contact.jobTitle || contact.job_title || 'CTO',
    company_name: contact.companyName || contact.company_name || 'Acme Corp',
    industry: contact.industry || 'Software',
    technology_stack: contact.technologyStack || contact.technology_stack || [],
    country: contact.country || 'United States',
    company_description: contact.companyDescription || contact.company_description || '',
    company_size: contact.companySize || contact.company_size || '',
    headline: contact.headline || '',
    seniority_level: contact.seniorityLevel || contact.seniority_level || ''
  };

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  const [resultA, resultB] = await Promise.all([
    openai.generateEmail(contactData, brand, brand.abTest.promptA),
    openai.generateEmail(contactData, brand, brand.abTest.promptB)
  ]);

  return res.json({
    variantA: resultA || { subject: 'Generation failed', body: 'Could not generate variant A' },
    variantB: resultB || { subject: 'Generation failed', body: 'Could not generate variant B' },
    tokens: (resultA?.tokens || 0) + (resultB?.tokens || 0)
  });
}));

module.exports = router;
