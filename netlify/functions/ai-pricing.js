// Netlify serverless function for AI pricing recommendations

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userMessage, projectName, clientName, options, conversationHistory } = JSON.parse(event.body);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server not configured: missing ANTHROPIC_API_KEY.' })
      };
    }

    if (!userMessage || !options) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Build the options summary for the AI
    const optionsSummary = options.map(opt => {
      const itemsList = opt.items.map(item =>
        `  - ${item.description} (${item.section}): ${item.quantity} x $${item.unitPrice}`
      ).join('\n');

      return `
**${opt.name}** (ID: ${opt.tabId})
- Cost (Ex GST): $${opt.costExGST.toFixed(2)}
- Current Price (Inc GST): $${opt.currentPriceIncGST.toFixed(2)}
- Current Profit (Ex GST): $${opt.currentProfitExGST.toFixed(2)}
- Current Markup: ${opt.currentMarkup.toFixed(1)}%
- Current Margin: ${opt.currentMargin.toFixed(1)}%
- Payment Term: ${opt.paymentTerm} months
- Current Monthly: $${opt.currentMonthly.toFixed(2)}/mo
Items:
${itemsList}`;
    }).join('\n\n');

    // Build conversation messages
    const messages = [];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }

    // Add the current user message with context
    messages.push({
      role: 'user',
      content: `Project: ${projectName}
Client: ${clientName}

Current Pricing Options:
${optionsSummary}

User's Context/Request:
${userMessage}

Based on this information, provide pricing recommendations for each option. Consider:
1. The client situation and project context
2. Competitive pricing that wins business
3. Healthy profit margins (typically 15-35% markup is standard)
4. Round numbers that look professional
5. The relationship between options (upgrades should feel worth it)

Respond with a JSON object (no markdown code blocks) with this structure:
{
  "explanation": "Brief explanation of your pricing strategy (2-3 sentences)",
  "recommendations": [
    {
      "tabId": "tab-1",
      "name": "Option Name",
      "costExGST": 1000.00,
      "suggestedPriceIncGST": 1500.00,
      "paymentTerm": 24,
      "reasoning": "Short reason for this specific price"
    }
  ],
  "textMessageSummary": "A ready-to-send text message summary the user can copy and send to the client, listing all options with prices and a brief value proposition for each. Keep it professional but friendly."
}`
    });

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are an expert pricing consultant for a security and electrical installation business. Your job is to help price quotes competitively while maintaining healthy profit margins.

Key principles:
- Standard markup in this industry is 15-35% on materials, 10-25% on labour
- Round prices to clean numbers ($1,495 not $1,487.32)
- Monthly payments should be round numbers when possible
- Premium/upgrade options should show clear value vs basic options
- Consider the client relationship and project size
- Always return valid JSON, no markdown code blocks`,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: error.error?.message || 'API request failed' })
      };
    }

    const data = await response.json();

    // Extract the text content and parse it
    let responseText = data.content[0].text.trim();

    // Remove markdown code blocks if present
    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Parse the JSON response
    const recommendations = JSON.parse(responseText);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(recommendations)
    };

  } catch (error) {
    console.error('AI Pricing Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
