/**
 * Canonical input schema for Apify actor IoSHqwTR9YGhzccez
 * "Leads Finder - $1.5/1k leads with Emails [Apollo Alternative]"
 * by code_crafter/leads-finder
 *
 * Verified from live actor console + user-provided JSON input.
 * DO NOT CHANGE field names — they must match the actor exactly.
 */

// fetch_count must always be set — omitting causes infinite runs
const DEFAULT_FETCH_COUNT = 100;
const MAX_FETCH_COUNT     = 2000;

const SENIORITY_LEVEL = [
  'founder', 'owner', 'c_suite', 'director', 'partner',
  'vp', 'head', 'manager', 'senior', 'entry', 'trainee'
];

const FUNCTIONAL_LEVEL = [
  'finance', 'product_management', 'engineering', 'design', 'education',
  'c_suite', 'human_resources', 'information_technology', 'legal',
  'marketing', 'operations', 'sales'
];

const EMAIL_STATUS = ['validated', 'not_validated', 'unknown'];

// size field — exact strings accepted by the actor
const COMPANY_SIZE = [
  '1-10', '11-20', '21-50', '51-100', '101-200', '201-500',
  '501-1000', '1001-2000', '2001-5000', '5001-10000',
  '10001-20000', '20001-50000', '50000+'
];

const FUNDING = [
  'seed', 'angel', 'series_a', 'series_b', 'series_c', 'series_d',
  'series_e', 'series_f', 'venture_round', 'debt_financing',
  'convertible_note', 'private_equity_round', 'other_round'
];

// Revenue dropdown options (exact values accepted by actor)
const REVENUE_OPTIONS = [
  '', '100K', '500K', '1M', '2M', '5M', '10M',
  '25M', '50M', '100M', '250M', '500M', '1B'
];

// Complete industry list — use EXACT strings, no variations
const COMPANY_INDUSTRY = [
  'information technology & services', 'construction', 'marketing & advertising',
  'consumer services', 'financial services', 'hospital & health care', 'automotive',
  'restaurants', 'education management', 'food & beverages', 'design', 'hospitality',
  'accounting', 'events services', 'retail', 'nonprofit organization management',
  'entertainment', 'electrical/electronic manufacturing', 'internet',
  'leisure, travel & tourism', 'professional training & coaching',
  'transportation/trucking/railroad', 'law practice', 'real estate',
  'health, wellness & fitness', 'management consulting', 'computer software',
  'apparel & fashion', 'architecture & planning', 'mechanical or industrial engineering',
  'insurance', 'telecommunications', 'human resources', 'staffing & recruiting',
  'sports', 'legal services', 'oil & energy', 'media production', 'machinery',
  'wholesale', 'consumer goods', 'music', 'photography', 'medical practice',
  'cosmetics', 'environmental services', 'graphic design',
  'business supplies & equipment', 'renewables & environment', 'facilities services',
  'publishing', 'food production', 'arts & crafts', 'building materials',
  'civil engineering', 'religious institutions', 'public relations & communications',
  'higher education', 'printing', 'furniture', 'mining & metals',
  'logistics & supply chain', 'research', 'pharmaceuticals',
  'individual & family services', 'medical devices', 'civic & social organization',
  'e-learning', 'security & investigations', 'chemicals', 'government administration',
  'online media', 'investment management', 'farming', 'writing & editing', 'textiles',
  'mental health care', 'primary/secondary education', 'broadcast media', 'biotechnology',
  'information services', 'international trade & development', 'motion pictures & film',
  'consumer electronics', 'banking', 'import & export', 'industrial automation',
  'recreational facilities & services', 'performing arts', 'utilities', 'sporting goods',
  'fine art', 'airlines/aviation', 'computer & network security', 'maritime',
  'luxury goods & jewelry', 'veterinary', 'venture capital & private equity',
  'commercial real estate', 'wine & spirits', 'plastics', 'aviation & aerospace',
  'computer games', 'packaging & containers', 'executive office', 'computer hardware',
  'computer networking', 'market research', 'outsourcing/offshoring',
  'program development', 'translation & localization', 'philanthropy', 'public safety',
  'alternative medicine', 'museums & institutions', 'warehousing', 'defense & space',
  'newspapers', 'paper & forest products', 'law enforcement', 'investment banking',
  'government relations', 'fund-raising', 'think tanks', 'glass, ceramics & concrete',
  'capital markets', 'semiconductors', 'animation', 'political organization',
  'package/freight delivery', 'wireless', 'international affairs', 'public policy',
  'libraries', 'gambling & casinos', 'railroad manufacture', 'ranching', 'military',
  'fishery', 'supermarkets', 'dairy', 'tobacco', 'shipbuilding', 'judiciary',
  'alternative dispute resolution', 'nanotechnology', 'agriculture', 'legislative office'
];

module.exports = {
  DEFAULT_FETCH_COUNT,
  MAX_FETCH_COUNT,
  SENIORITY_LEVEL,
  FUNCTIONAL_LEVEL,
  EMAIL_STATUS,
  COMPANY_SIZE,
  FUNDING,
  REVENUE_OPTIONS,
  COMPANY_INDUSTRY
};
