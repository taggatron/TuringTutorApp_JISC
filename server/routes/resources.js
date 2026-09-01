import express from 'express';
import { checkAuth } from '../middleware/auth.js';
import {
  createResource,
  getResources,
  getResourceById,
  deleteResource,
  updateResource
} from '../db/postgres.js';
import { fetchWebResource } from '../services/webScraper.js';
import { searchWeb } from '../services/webSearch.js';

const router = express.Router();

// Apply authentication to all resource endpoints
router.use(checkAuth);

/**
 * GET /api/resources
 * Retrieves all saved resources for the current authenticated user.
 */
router.get('/resources', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const typeFilter = req.query.type || 'all';
    const resources = await getResources(userId, typeFilter);
    res.json({ success: true, resources });
  } catch (err) {
    console.error('Error fetching user resources:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve resources' });
  }
});

/**
 * POST /api/resources
 * Creates or updates a saved resource for the current authenticated user.
 */
router.post('/resources', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const {
      type = 'web_page',
      title,
      url,
      domain,
      description = '',
      content = '',
      origin = 'student_web',
      metadata_json = {}
    } = req.body || {};

    if (!title && !url) {
      return res.status(400).json({ success: false, message: 'Resource requires at least a title or URL' });
    }

    // Default metadata ensuring student agency flags are preserved
    const meta = {
      ai_discovered: false,
      student_selected: true,
      used_in_response: false,
      dateAdded: new Date().toISOString(),
      ...(typeof metadata_json === 'object' ? metadata_json : {})
    };

    const result = await createResource(userId, {
      type,
      title: title || (url ? new URL(url).hostname : 'Untitled Resource'),
      url: url || '',
      domain: domain || (url ? new URL(url).hostname.replace(/^www\./, '') : ''),
      description,
      content,
      origin,
      metadata_json: meta
    });

    res.json({
      success: true,
      resource: result.resource,
      alreadyExisted: result.alreadyExisted,
      message: result.alreadyExisted ? 'Resource updated' : 'Resource added successfully'
    });
  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ success: false, message: 'Failed to save resource' });
  }
});

/**
 * GET /api/resources/:id
 * Retrieves a specific resource owned by the current authenticated user.
 */
router.get('/resources/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const resourceId = parseInt(req.params.id, 10);
    if (!userId || isNaN(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource ID' });
    }

    const resource = await getResourceById(resourceId, userId);
    if (!resource) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    res.json({ success: true, resource });
  } catch (err) {
    console.error('Error fetching resource by ID:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch resource' });
  }
});

/**
 * DELETE /api/resources/:id
 * Deletes a resource owned by the current authenticated user.
 */
router.delete('/resources/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const resourceId = parseInt(req.params.id, 10);
    if (!userId || isNaN(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource ID' });
    }

    const deleted = await deleteResource(resourceId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Resource not found or unauthorized' });
    }

    res.json({ success: true, message: 'Resource removed successfully' });
  } catch (err) {
    console.error('Error deleting resource:', err);
    res.status(500).json({ success: false, message: 'Failed to delete resource' });
  }
});

/**
 * PATCH /api/resources/:id
 * Updates title, description or metadata for a resource owned by the user.
 */
router.patch('/resources/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const resourceId = parseInt(req.params.id, 10);
    if (!userId || isNaN(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource ID' });
    }

    const { title, description, metadata_json } = req.body || {};
    const updated = await updateResource(resourceId, userId, { title, description, metadata_json });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Resource not found or unauthorized' });
    }

    res.json({ success: true, resource: updated });
  } catch (err) {
    console.error('Error updating resource:', err);
    res.status(500).json({ success: false, message: 'Failed to update resource' });
  }
});

/**
 * POST /api/web-resource
 * Safe server-side reader fetcher with SSRF protection, DNS validation, and HTML sanitization.
 */
router.post('/web-resource', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, message: 'A valid URL is required' });
    }

    const scrapeResult = await fetchWebResource(url);
    if (!scrapeResult.success) {
      return res.status(400).json({
        success: false,
        message: scrapeResult.error || 'Failed to retrieve web resource'
      });
    }

    res.json({
      success: true,
      resource: scrapeResult.resource
    });
  } catch (err) {
    console.error('Error fetching web resource:', err);
    res.status(500).json({ success: false, message: 'Error loading web resource' });
  }
});

/**
 * GET /api/web-search
 * Modular web search endpoint for student research queries.
 */
router.get('/web-search', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ success: false, message: 'Search query is required' });
    }

    const searchData = await searchWeb(query.trim());
    res.json({
      success: true,
      ...searchData
    });
  } catch (err) {
    console.error('Error in web-search endpoint:', err);
    res.status(500).json({ success: false, message: 'Web search encountered an error' });
  }
});

export default router;
