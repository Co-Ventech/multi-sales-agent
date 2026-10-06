const OpenAI = require('openai');
const { buildEmailPrompt, buildFollowUpPrompt } = require('../utils/emailTemplates');

class OpenAIService {
  constructor(apiKey, model = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
    this.model = model || 'gpt-4o';
  }

  async generateEmail(contact, brand, systemPrompt = null) {
    const prompt = systemPrompt || brand.openai?.systemPrompt;
    const useMinimal = !!(prompt);

    const userMessage = buildEmailPrompt(
      contact,
      brand.company?.name || brand.name,
      {
        tone: brand.campaign?.tone,
        cta: brand.campaign?.cta,
        valueProp: brand.campaign?.valueProp,
        calendlyUrl: brand.campaign?.calendlyUrl,
        minimal: useMinimal
      }
    );

    const messages = [];
    if (prompt) messages.push({ role: 'system', content: prompt });
    messages.push({ role: 'user', content: userMessage });

    return this._callWithRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: brand.openai?.temperature ?? 0.75,
        max_tokens: brand.openai?.maxTokens ?? 400
      })
    );
  }

  async generateFollowUp(contact, brand, followUpNumber) {
    const userMessage = buildFollowUpPrompt(
      contact,
      followUpNumber,
      brand.company?.name || brand.name,
      brand
    );

    const messages = [{ role: 'user', content: userMessage }];

    return this._callWithRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: brand.openai?.temperature ?? 0.75,
        max_tokens: 300
      })
    );
  }

  /**
   * Wrap an OpenAI call with retry logic.
   * - 429 + insufficient_quota → throw QUOTA_EXCEEDED (not retryable; caller should leave contact Pending)
   * - 429 rate_limit / 5xx     → retry with exponential backoff (1s, 3s, 7s)
   * - other errors             → return null (treat as soft failure)
   */
  async _callWithRetry(fn) {
    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fn();
        const content = response.choices[0]?.message?.content || '';
        const parsed = this._parse(content);
        parsed.tokens = response.usage?.total_tokens || null;
        return parsed;
      } catch (err) {
        lastErr = err;
        const status = err.status || err.response?.status;
        const code = err.code || err.error?.code || err.response?.data?.error?.code;
        const isQuotaExhausted = code === 'insufficient_quota' || /exceeded your current quota/i.test(err.message || '');
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (isQuotaExhausted) {
          const e = new Error('OPENAI_QUOTA_EXCEEDED');
          e.code = 'QUOTA_EXCEEDED';
          e.cause = err;
          throw e;
        }

        if (isRetryable && attempt < maxAttempts) {
          const backoffMs = [1000, 3000, 7000][attempt - 1];
          console.warn(`[OpenAI] ${status} on attempt ${attempt}/${maxAttempts}, retrying in ${backoffMs}ms`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }

        console.error('[OpenAI] error:', err.message);
        return null;
      }
    }
    console.error('[OpenAI] retries exhausted:', lastErr?.message);
    return null;
  }

  _parse(content) {
    if (!content) return { subject: '', body: '' };

    const lines = content.split('\n');
    let subject = '';
    let bodyStart = -1;

    // Find "Subject:" line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.toLowerCase().startsWith('subject:')) {
        subject = line.substring('subject:'.length).trim();
        // Body starts after the first blank line following subject
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '') {
            bodyStart = j + 1;
            break;
          }
        }
        // If no blank line, body starts right after subject
        if (bodyStart === -1) bodyStart = i + 1;
        break;
      }
    }

    const body = bodyStart >= 0
      ? lines.slice(bodyStart).join('\n').trim()
      : content.trim();

    return { subject, body };
  }
}

module.exports = OpenAIService;
