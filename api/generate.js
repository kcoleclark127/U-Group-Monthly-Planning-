// api/generate.js
//
// Vercel serverless function for the U-Group Monthly Plan tool.
//
// What this does: takes the leader's raw form submission and asks Claude
// to reorganize it into a clean, consistently-shaped JSON object that the
// frontend then renders as the print-ready plan. It intentionally does
// NOT write, rewrite, summarize, or add content — every text value that
// comes back is the leader's own words, just sorted into the right slots.
//
// Required environment variable (set in Vercel Project Settings -> 
// Environment Variables): ANTHROPIC_API_KEY

const OUTPUT_SCHEMA = `{
  "header": {
    "leaders": string,
    "groupType": string,
    "monthSeason": string,
    "groupDates": string,
    "allGroupDate": string
  },
  "weeks": [
    {
      "weekNumber": number,
      "location": string,
      "dayTime": string,
      "drivers": string,
      "funHook": string,
      "familyMoment": string,
      "faithLead": string,
      "prepTogether": boolean,
      "parentPlan": string,
      "parentSendLocations": boolean,
      "parentSendReminders": boolean,
      "studentPlan": string,
      "studentTextEach": boolean,
      "studentChecklist": boolean,
      "followUp": string
    }
  ],
  "bucketList": {
    "activities": string[],
    "customIdea": string,
    "questions": string[]
  }
}`;

const SYSTEM_PROMPT = `You are a formatting assistant for a youth ministry's U-Group monthly planning tool. A small group leader has filled out a planning form. Your ONLY job is to reorganize their exact submission into the JSON schema below.

Hard rules:
- Do not write, rewrite, rephrase, summarize, correct grammar, or add any content of your own.
- Every string value you output must be copied verbatim from the matching input field, trimming only leading/trailing whitespace.
- Every boolean value must be copied through completely unchanged.
- If a text field is empty or missing in the input, output it as an empty string "".
- Include all 4 weeks in the same order they were submitted. Never omit a week or a field.
- Do not invent, reorder, merge, or drop any bucket list activity or question the leader selected.

Return ONLY valid JSON matching this exact structure, with no markdown code fences, no commentary before or after, and no extra keys:

${OUTPUT_SCHEMA}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel Project Settings.' });
  }

  const formData = req.body;

  if (!formData || !Array.isArray(formData.weeks) || formData.weeks.length !== 4) {
    return res.status(400).json({ error: 'Malformed submission — expected 4 weeks of data.' });
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: JSON.stringify(formData) },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Anthropic API error:', anthropicResponse.status, errText);
      return res.status(502).json({ error: 'The formatting service failed. Please try again.' });
    }

    const data = await anthropicResponse.json();

    const rawText = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse model output as JSON:', cleaned);
      return res.status(502).json({ error: 'Could not process the plan. Please try again.' });
    }

    if (!parsed.header || !Array.isArray(parsed.weeks) || !parsed.bucketList) {
      console.error('Model output missing expected shape:', parsed);
      return res.status(502).json({ error: 'The formatted plan came back incomplete. Please try again.' });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Unexpected error in /api/generate:', err);
    return res.status(500).json({ error: 'Something went wrong generating the plan.' });
  }
}
