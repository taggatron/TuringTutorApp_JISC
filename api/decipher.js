import { callAzureOpenAI, sanitizeContent } from './utils/azureOpenAI.js';

export const config = {
    runtime: 'nodejs',
    maxDuration: 60
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { content } = req.body || {};

    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Missing content for decipher assessment' });
    }

    try {
        const feedbackSystemPrompt = `You are an academic assessor. Evaluate the provided editable content (up to the References section) against the following rubric and guidance. Return:
1) A concise criteria summary with headings P1, P2, M2, D1, each with Pass/Merit/Distinction alignment and 1–2 actionable improvements.
2) A short overall note (max 60 words) encouraging next steps.

Rubric (abbreviated):
P1: Use research to identify a range of potential diseases that the patients might have. At least four possible diseases per patient. (PO4)
M1: Assess two suspected diseases for each patient in terms of potential likelihood given the symptoms; include a hypothesis backed by facts. (PO3)
P2: Create a detailed method including equipment (sizes/quantities/PPE), tests and techniques to investigate samples, informed by P1. (PO4)
M2: Explain the rationale for chosen tests/techniques based on suspected diseases (extends P2/M1). (PO2)
D1: Justify the choice/settings of appropriate equipment for chosen tests/techniques (extends M2). (PO3)
P3: Complete an appropriate risk assessment using the provided template, considering risks/hazards for each test/technique. (PO4)

Guidance:
P1: Students explain independent research process, sources, and rationale; minimum four diseases per patient.
P2: Step-by-step method; list equipment with sizes/quantities/PPE; align tests/techniques to suspected diseases and available kit.
P3: Thorough risk assessment per test/technique.
M1: Reasoned judgement for two diseases per patient; likelihood based on symptoms; include hypotheses supported by research.
M2: Further analysis building on P2/M1.
D1: Justify equipment choice/settings as part of the rationale.

Output format (markdown allowed):
P1: Status – brief improvement
P2: Status – brief improvement
M2: Status – brief improvement
D1: Status – brief improvement
Overall: …`;

        const MAX_MESSAGE_CHARS = 15000;
        const cleanedUser = sanitizeContent(content, MAX_MESSAGE_CHARS);

        const response = await callAzureOpenAI({
            messages: [
                { role: 'system', content: feedbackSystemPrompt },
                { role: 'user', content: cleanedUser }
            ],
            stream: false
        });

        const json = await response.json();
        let result = '';
        if (json.choices && json.choices[0] && json.choices[0].message) {
            result = json.choices[0].message.content || '';
        } else if (json.output && json.output[0] && json.output[0].content && json.output[0].content[0]) {
            result = json.output[0].content[0].text || '';
        }

        return res.status(200).json({ success: true, feedback: result.trim() });
    } catch (error) {
        console.error('Error generating decipher feedback:', error);
        return res.status(500).json({ success: false, error: error.message || 'Error generating decipher feedback' });
    }
}
