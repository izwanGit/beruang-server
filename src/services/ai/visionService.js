// src/services/ai/visionService.js
// Gemini 2.5 Flash Vision Service (Google AI)

const axios = require('axios');
const { GOOGLE_API_KEY } = require('../../config/env');

/**
 * Scan receipt image and extract transaction details
 */
async function scanReceipt(base64Image) {
  const prompt = `
    Analyze this receipt image and extract details in STRICT JSON format.
    
    Extraction Logic:
    1. Merchant: Look for the business/shop/stall name at the very TOP of the receipt.
    2. Description: Create a SHORT, classifier-friendly summary:
       - Combine the FOOD TYPE or BRAND with a simple category word.
       - Examples: "Ayam Gepuk Meal", "McDonalds Burger", "Starbucks Coffee", "7-Eleven Snacks", "Grocery Shopping", "Pharmacy Medicine".
       - Do NOT list every item (e.g., avoid "Ayam Bumbu Crispy, Sambal Extra Pedas, Teh O Ais").
       - Do NOT use overly generic terms alone (e.g., avoid just "Meal" or "Food").
       - The description should be 2-4 words max.

    JSON Structure:
    {
      "amount": number,
      "merchant": "string",
      "description": "string" (2-4 word summary combining type/brand + category),
      "date": "YYYY-MM-DD"
    }
    
    Context Rules:
    - Works for ANY receipt (restaurants, groceries, pharmacies, retail, etc).
    - Return ONLY the JSON. No markdown backticks.
  `;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

  const response = await axios.post(url, {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: "image/jpeg", data: base64Image } }
      ]
    }]
  });

  const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
  let result = JSON.parse(aiText);

  // Defensive: If AI returns an array or unexpected structure, extract the first item
  if (Array.isArray(result)) result = result[0];
  if (result.transactions && Array.isArray(result.transactions)) result = result.transactions[0];

  return result;
}

/**
 * Parse bulk text data into transactions
 * NOTE: Only extracts name/amount/date. Categorization happens on frontend
 * so that overflow checks and gamification features work correctly.
 */
async function parseBulkData(text) {
  const prompt = `
    Analyze the following text and extract a list of transactions. 
    The text might be messy (from Excel, Notes, or Chat).
    Return a JSON object with a "transactions" key containing an array of objects:
    {
      "transactions": [
        {
          "name": "string (Description - clean up typos, e.g., 'strbk' -> 'Starbucks Coffee', 'kfcc' -> 'KFC Meal')",
          "amount": number (Amount spent - calculate math if needed, e.g., '3 x 25' = 75),
          "date": "YYYY-MM-DD" (If missing, omit this field. Convert 'ytd' to yesterday, 'today' to today)
        }
      ]
    }
    Rules:
    1. Fix typos and abbreviations (e.g., "mkn" -> "Makan", "pking" -> "Parking").
    2. Convert Malay day names (Isnin=Monday, Selasa=Tuesday, etc.) to actual dates based on current week.
    3. Do NOT include category - it will be determined separately by local AI.
    4. RETURN ONLY JSON. No markdown, no backticks.
    
    Today's date: ${new Date().toISOString().split('T')[0]}
    
    Text to parse:
    "${text}"
  `;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

  const response = await axios.post(url, {
    contents: [{
      parts: [{ text: prompt }]
    }]
  });

  const aiText = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(aiText);
}

module.exports = {
  scanReceipt,
  parseBulkData
};
