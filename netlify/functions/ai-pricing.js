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

    // Check if this is a follow-up message (has conversation history)
    const isFollowUp = conversationHistory && conversationHistory.length > 0;

    // Add the current user message with context
    if (isFollowUp) {
      // Follow-up message - just send the user's response
      messages.push({
        role: 'user',
        content: `${userMessage}

Current options data for reference:
${optionsSummary}

If you're adjusting recommendations based on my feedback, respond with the same JSON structure. If you're just discussing strategy, you can respond conversationally without JSON.`
      });
    } else {
      // First message - include full context and instructions
      messages.push({
        role: 'user',
        content: `Project: ${projectName}
Client: ${clientName}

My Pricing Options:
${optionsSummary}

Context from me:
${userMessage}

I need your help pricing these options strategically. Tell me:
1. What prices you suggest for each option and WHY
2. How the pricing creates anchoring and makes certain options feel like no-brainers
3. Which option you're trying to steer the client toward and why
4. How much profit I'll make on each

Be conversational - explain your thinking like you're coaching me on pricing strategy. After your explanation, include a JSON block with the specific numbers.

Respond with your strategic explanation first, then end with a JSON object (no markdown code blocks) with this structure:
{
  "recommendations": [
    {
      "tabId": "tab-1",
      "name": "Option Name",
      "costExGST": 1000.00,
      "suggestedPriceIncGST": 1500.00,
      "paymentTerm": 24,
      "reasoning": "The anchoring/strategic reason for this price"
    }
  ],
  "textMessageSummary": "A ready-to-send text message I can copy and send to the client. Present the options in order from highest to lowest price (anchor high first). Make the target option sound like incredible value. Keep it professional but friendly, not salesy."
}`
      });
    }

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
        system: `You are a pricing strategist who specializes in Alex Hormozi-style value-based pricing and price anchoring. You help trades businesses (security, electrical, AV) price their quotes to maximize both close rates AND profit.

HORMOZI PRICING PRINCIPLES YOU APPLY:
1. **Anchor High First** - Always present the premium option first to set the reference point. Everything else feels cheaper by comparison.

2. **The Decoy Effect** - Structure pricing so one option is obviously the "smart choice." The premium anchors high, the budget option feels like you're missing out, and the middle option feels like the sweet spot.

3. **Price to Value, Not Cost** - Don't just mark up costs. Price based on the VALUE and OUTCOME the client gets. A $2,000 intercom upgrade that solves 10 years of problems is worth more than the parts cost.

4. **Make the Math Easy** - Use round numbers. $2,995 not $2,847. Monthly payments should be clean: $125/mo not $118.62/mo.

5. **Create No-Brainer Gaps** - The jump from basic to mid-tier should feel like "for just $X more, I get so much more value." Make upgrading feel stupid NOT to do.

6. **Strategic Profit Distribution** - It's OK to have lower margins on the anchor (premium) option. The goal is to make the TARGET option (where you want them to land) feel irresistible while still being very profitable for you.

WHEN GIVING RECOMMENDATIONS:
- Be conversational and explain your strategy like a coach
- Tell them exactly which option you're steering toward and why
- Explain the psychology of why each price works
- Show them the profit they'll make
- Be direct about the anchoring tactics you're using

You're not just calculating markup - you're engineering a pricing structure that makes the client feel smart choosing the option that's also great for the business.

When including JSON, output it raw without markdown code blocks.`,
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

    // Extract the text content
    let responseText = data.content[0].text.trim();

    // Try to find JSON in the response (it might be at the end after explanation)
    let explanation = '';
    let recommendations = null;
    let textMessageSummary = '';

    // Look for JSON object in the response
    const jsonMatch = responseText.match(/\{[\s\S]*"recommendations"[\s\S]*\}/);

    if (jsonMatch) {
      // Extract explanation (everything before the JSON)
      const jsonStartIndex = responseText.indexOf(jsonMatch[0]);
      explanation = responseText.substring(0, jsonStartIndex).trim();

      // Parse the JSON
      let jsonText = jsonMatch[0];
      // Remove any markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      try {
        const parsed = JSON.parse(jsonText);
        recommendations = parsed.recommendations || [];
        textMessageSummary = parsed.textMessageSummary || '';
      } catch (e) {
        // JSON parsing failed, treat whole response as explanation
        explanation = responseText;
      }
    } else {
      // No JSON found - this is a conversational follow-up
      explanation = responseText;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        explanation: explanation,
        recommendations: recommendations,
        textMessageSummary: textMessageSummary
      })
    };

  } catch (error) {
    console.error('AI Pricing Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
