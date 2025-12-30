const express = require('express');
const router = express.Router();
const tracerouteService = require('../services/tracerouteService');
const { db } = require('../config/supabase');
const NodeCache = require('node-cache');

// Cache for 1 hour
const cache = new NodeCache({ stdTTL: 3600 });

/**
 * POST /api/trace
 * Main traceroute endpoint
 */
router.post('/', async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ 
        error: 'Domain is required',
        example: { domain: 'google.com' }
      });
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({ 
        error: 'Invalid domain format',
        domain: domain
      });
    }

    // Check cache
    const cacheKey = `trace_${domain}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit for ${domain}`);
      return res.json({ ...cached, cached: true });
    }

    console.log(`🔍 Starting trace for: ${domain}`);

    // Run traceroute
    const result = await tracerouteService.traceRoute(domain);

    if (result.error) {
      return res.status(500).json({ 
        error: result.error,
        domain: domain
      });
    }

    // Cache result
    cache.set(cacheKey, result);

    // Save to database (non-blocking)
    db.saveTraceRequest({
      domain: result.domain,
      sourceIp: req.ip,
      totalHops: result.totalHops,
      totalDistance: result.totalDistance,
      totalTime: result.totalTime,
      hasCdn: result.hasCdn,
      cdnProvider: result.cdnProvider
    }).catch(err => console.error('DB save failed:', err.message));

    res.json(result);

  } catch (error) {
    console.error('Trace error:', error);
    res.status(500).json({ 
      error: 'Traceroute failed',
      message: error.message 
    });
  }
});

/**
 * GET /api/trace/popular
 * Get most traced domains
 */
router.get('/popular', async (req, res) => {
  try {
    const popular = await db.getPopularDomains(10);
    res.json({ popular });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trace/clear-cache
 * Clear cache (admin endpoint)
 */
router.get('/clear-cache', (req, res) => {
  const keys = cache.keys();
  cache.flushAll();
  res.json({ 
    message: 'Cache cleared',
    clearedKeys: keys.length
  });
});

module.exports = router;