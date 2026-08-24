export const config = {
    runtime: 'nodejs',
    api: {
        bodyParser: {
            sizeLimit: '10mb'
        }
    }
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

    try {
        const dataUrl = req.body && req.body.dataUrl ? String(req.body.dataUrl) : '';
        if (!dataUrl) return res.status(400).json({ success: false, message: 'dataUrl required' });

        // In serverless environments, return the dataUrl directly or echo back as valid data URL image
        return res.status(200).json({ success: true, url: dataUrl });
    } catch (err) {
        console.error('Upload image failed:', err);
        return res.status(500).json({ success: false, message: 'Failed to process image' });
    }
}
