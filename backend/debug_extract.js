const LINKEDIN_URL_REGEX = /https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_%]+\/?/gi;

const FIRST_NAMES = new Set(['james','john','michael','david','robert','william','richard','thomas','charles','daniel','matthew','anthony','mark','paul','andrew','steven','kevin','brian','edward','ronald','timothy','jason','jeffrey','ryan','emma','olivia','sophia','isabella','ava','emily','abigail','elizabeth','mason','ethan','noah','liam','benjamin','oliver','alexander','henry','sebastian','aidan','jacob','muhammad','larry','kim','tom','alex','chris','taylor','jordan','casey','riley','quinn','morgan','dana','jamie','lee','kelly','neil','sunita','ali','abdullah','abigale','max','joseph','chad','an','tiago','angry','therese','umut','colton','fannie','sandi','karina','urbano','antoine','roberto','joe','adam','eric','dean','majid','percy','ron','nicole','jan','rick','felix','joeri','patti','saul','tee','teddy','eli','romeo','ayo','dino','carolyn']);

const BAD_SUBSTRINGS = new Set(['looking for','seeking for','seeking a','project for','need for','help for','looking','seeking','hiring','someone','anyone','requirements','overview','scope of work','timeline','budget','responsibilities','qualifications','skills','experience','key features','design and','build and','develop and','create and','we want','we need','for more','for this','freelancer','specialist','consultant','manager','coordinator','assistant','developer','engineer','designer','contractor','expert','chrome','firefox','microsoft edge','opera','safari','figma','sketch','adobe','illustrator','photoshop','canva','loom','docusign','zapier','make','n8n','pipedrive','salesforce','hubspot','intercom','klaviyo','mailchimp','webflow','squarespace','wix','kajabi','wordpress','shopify','woocommerce','bigcommerce','magento','prestashop','react','vue','angular','nextjs','next.js','nodejs','node.js','flutter','swift','kotlin','java','python','ios','android','web app','mobile app','stripe','paypal','braintree','coinbase','btcpay','tagkings','target mvp','mvp delivery','estimated time','loo','linkedin','facebook','twitter','instagram','pagespeed','pages insight','lighthouse','seo audit','amazon web','aws','google cloud','azure','google analytics','ga4','gtm','zillow','redfin','mls','realtor','udemy','teachable','gumroad','coursera','discord','slack','teams','zoom','meet','chatgpt','gpt','openai','claude','gemini','ai','llm','spoonacular','falcon','koongo','selenium','django','firebase','bubble','xano','weweb','supabase','botpress','frontend','backend','fullstack','full-stack','northwoodsbitcoin','brainathlete','description:','title job','changes to custom','job overview','project overview','project details','job details','scope of work','this role','role include','team composition','supply chain','inventory manage','legal pages','automatic platform','phase prototype','discovery please','sast, dast','dependency scanning','facebook tiktok','tiktok pinterest','instagram facebook','chrome, firefox','uae central bank','lightning web components','design qa','hand-off support','recruiting','thedragontrip','one organised','also open to future projects','target mvp delivery','about lami architects','about the company','about the project','about the role','job description','role description','project description','service provider','service-provider','built in java','basic seo setup','changes to custom','shopify website','am looking','are looking','is looking','for a skilled','for a senior','for an experienced','looking for an','to a professional','ios and android','ios android','native plugin','mobile application','shopify store','wordpress website','wix website','android service','service-provider','shopify app','wordpress site','react native','react js','next js app','vue js','angular js','node js','flutter app','flutter mobile','python script','python django','python flask']);

const TECH_WORDS = new Set(['shopify','wordpress','wix','squarespace','webflow','magento','woocommerce','bigcommerce','prestashop','kajabi','react','vue','angular','nextjs','nodejs','flutter','swift','kotlin','java','python','golang','rust','c++','c#','ruby','php','laravel','django','flask','fastapi','express','rails','spring','firebase','supabase','xano','weweb','bubble','nocodb','stripe','paypal','braintree','coinbase','hubspot','salesforce','pipedrive','intercom','klaviyo','mailchimp','zapier','make','n8n','docusign','loops','sendgrid','figma','sketch','adobe','illustrator','photoshop','canva','invision','selenium','playwright','cypress','puppeteer','aws','azure','gcp','google cloud','heroku','vercel','netlify','docker','kubernetes','terraform','ansible','mongodb','mysql','postgresql','redis','elasticsearch','graphql','rest','api','sdk','cli','chatgpt','openai','claude','gemini','llm','ai','ml','spoonacular','koongo','falcon','botpress','cal.com','ghost','typeform','trello','asana','notion','slack','discord','algolia','cloudflare','fastly','sendgrid','mailgun']);

const GENERIC_SINGLE = new Set(['company','brand','startup','platform','agency','studio','team','project','app','product','service','business','website','store','portal']);

const DESCRIPTOR_PREFIXES = new Set(['about','overview','introduction','project','job','role','position','description','details','scope','responsibilities','requirements','title','summary','note','here is']);

function isGoodCompanyName(name) {
  if (!name || name.length < 3) return false;
  const lower = name.toLowerCase();
  const words = name.split(/\s+/);
  if (!/[A-Z]/.test(name[0])) return false;
  if (words.some(w => w.length < 2)) return false;
  if (name.length > 50) return false;
  if (words.length === 1) {
    if (name.length < 4) return false;
    if (GENERIC_SINGLE.has(lower)) return false;
    if (TECH_WORDS.has(lower)) return false;
    if (FIRST_NAMES.has(lower)) return false;
    if (!/[A-Z]/.test(name[0]) || !/[a-z]/.test(name.slice(1))) return false;
    return true;
  }
  const camelCount = words.filter(w => /[A-Z]/.test(w) && /[a-z]/.test(w)).length;
  if (camelCount < words.length / 2) return false;
  if (words.some(w => FIRST_NAMES.has(w.toLowerCase()))) return false;
  if ([...BAD_SUBSTRINGS].some(bad => lower.includes(bad))) return false;
  if (DESCRIPTOR_PREFIXES.has(lower.split(/\s+/)[0])) return false;
  return true;
}

function cleanCandidate(raw) {
  let cleaned = raw.replace(/[™®©]/g, '').replace(/[,.\s]+$/, '').trim();
  const words = cleaned.split(/\s+/);
  const mid = Math.floor(words.length / 2);
  const firstHalf = words.slice(0, mid).join(' ');
  const secondHalf = words.slice(mid).join(' ');
  if (mid >= 1 && secondHalf.toLowerCase() === firstHalf.toLowerCase()) return firstHalf;
  if (words.length >= 4) {
    const chunkSize = Math.floor(words.length / 2);
    const a = words.slice(0, chunkSize).join(' ');
    const b = words.slice(chunkSize).join(' ');
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  return cleaned;
}

function findTitleLine(text) {
  const candidates = [];
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 4) continue;
    const m = line.match(/^([A-Z][a-zA-Z0-9]+(?:\s+[A-Za-z0-9&.,'\-]+){0,5})\s*[-–:]\s+.+/);
    if (m) {
      const name = cleanCandidate(m[1].trim());
      console.log('findTitleLine candidate:', JSON.stringify(name), 'isGood:', isGoodCompanyName(name));
      if (isGoodCompanyName(name)) candidates.push(name);
    }
  }
  return candidates;
}

const desc = 'We need to import products from Shopify to Spartoo marketplace using Koongo platform.\n\nNeed help to set up information properly on Koongo.\n\nFor proposals please let me know your pricing and start message with word Techno.\n\nThanks.';

console.log('findTitleLine:', findTitleLine(desc));

// Also test findCalled
function findCalled(text) {
  const candidates = [];
  const re = /(?:called|named)\s+(?:the\s+)?([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,4})\b/gi;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    console.log('findCalled candidate:', JSON.stringify(name), 'isGood:', isGoodCompanyName(name));
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

console.log('findCalled:', findCalled(desc));

// Test cleanCandidate directly
console.log('cleanCandidate("Koongo."):', JSON.stringify(cleanCandidate('Koongo.')));
console.log('cleanCandidate("Koongo platform."):', JSON.stringify(cleanCandidate('Koongo platform.')));
console.log('cleanCandidate("Koongo platform"):', JSON.stringify(cleanCandidate('Koongo platform')));