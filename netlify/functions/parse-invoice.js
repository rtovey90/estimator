// Netlify serverless function to proxy Claude API calls
// This avoids CORS issues when calling from browser

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { apiKey, pdfBase64 } = JSON.parse(event.body);

    if (!apiKey || !pdfBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing apiKey or pdfBase64' })
      };
    }

    // Call Claude API from server side (no CORS issues)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64
              }
            },
            {
              type: 'text',
              text: `Parse this supplier invoice/quotation and extract ALL line items. Return ONLY a JSON object with this exact structure (no markdown, no explanation):

{
  "supplier": "Company Name",
  "items": [
    {
      "code": "PRODUCT-CODE",
      "description": "Product description",
      "quantity": 1.5,
      "unitPriceExGST": 100.00
    }
  ]
}

Important rules:
- Extract the supplier/company name
- Include ALL line items from the invoice
- Use the unit price EXCLUDING GST (Ex GST price)
- If only Inc GST price is shown, divide by 1.1 to get Ex GST
- Quantity should be a number (convert "4.00" to 4)
- Include product codes if available
- Keep descriptions concise but complete
- Return ONLY the JSON, nothing else`
            }
          ]
        }]
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
