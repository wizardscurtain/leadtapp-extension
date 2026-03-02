require('dotenv').config();

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');
const express = require('express');

// =============================================================================
// Environment Variables - Read from process.env ONLY, never hardcoded
// =============================================================================

const AUDIENCELABS_API_KEY =
  process.env.AUDIENCELABS_API_KEY ||
  functions.config().audiencelabs?.api_key;

const GOOGLE_API_KEY =
  process.env.GOOGLE_API_KEY ||
  functions.config().gcp?.api_key;

if (!AUDIENCELABS_API_KEY) {
  console.error('FATAL: AUDIENCELABS_API_KEY is not set. Aborting.');
}
if (!GOOGLE_API_KEY) {
  console.error('FATAL: GOOGLE_API_KEY is not set.');
}

// =============================================================================
// Firebase Admin Initialization
// =============================================================================

const serviceAccount = process.env.GOOGLE_API_KEY
  ? (() => {
      try {
        return require(process.env.GOOGLE_API_KEY);
      } catch (e) {
        return undefined;
      }
    })()
  : undefined;

admin.initializeApp(
  serviceAccount
    ? { credential: admin.credential.cert(serviceAccount) }
    : { credential: admin.credential.applicationDefault() }
);

const db = admin.firestore();

// =============================================================================
// Lead Sanitization - Strips all upstream vendor references
// =============================================================================

/**
 * Sanitizes a raw lead object to remove any upstream vendor information.
 * This ensures the white-label branding is maintained.
 *
 * @param {Object} rawLead - The raw lead from upstream API
 * @returns {Object} - Sanitized lead safe for client delivery
 */
function sanitizeLead(rawLead) {
  // Field mapping: upstream field names -> normalized field names
  // AudienceLab returns CSV data with varying field names
  const fieldMapping = {
    // Identity
    'id': 'id',
    'email': 'email',
    'Email': 'email',
    'EMAIL': 'email',
    'personal_email': 'email',
    'work_email': 'workEmail',

    // Name fields
    'firstName': 'firstName',
    'first_name': 'firstName',
    'FirstName': 'firstName',
    'FIRST_NAME': 'firstName',
    'lastName': 'lastName',
    'last_name': 'lastName',
    'LastName': 'lastName',
    'LAST_NAME': 'lastName',
    'full_name': 'fullName',
    'name': 'fullName',

    // Phone
    'phone': 'phone',
    'Phone': 'phone',
    'PHONE': 'phone',
    'phone_number': 'phone',
    'mobile_phone': 'mobilePhone',
    'work_phone': 'workPhone',

    // Address
    'address': 'address',
    'Address': 'address',
    'street_address': 'address',
    'city': 'city',
    'City': 'city',
    'state': 'state',
    'State': 'state',
    'zip': 'zip',
    'Zip': 'zip',
    'zip_code': 'zip',
    'postal_code': 'zip',

    // Company
    'company': 'company',
    'company_name': 'company',
    'job_title': 'jobTitle',
    'title': 'jobTitle',
    'linkedin_url': 'linkedinUrl'
  };

  // Forbidden key patterns (case-insensitive)
  const forbiddenKeyPatterns = [
    'audience',
    'vendor',
    'supplier',
    'apiprovider',
    'apikey',
    'origin',
    'upstream',
    'source_id',
    'provider_id'
  ];

  // Forbidden value patterns (case-insensitive)
  const forbiddenValuePatterns = [
    'audiencelabs',
    'audiencelab',
    'audience_labs',
    'audience_lab'
  ];

  const sanitized = {};

  // Map fields using fieldMapping
  for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
    if (rawLead[sourceField] !== undefined && rawLead[sourceField] !== null && rawLead[sourceField] !== '') {
      sanitized[targetField] = rawLead[sourceField];
    }
  }

  // Generate ID if not present
  if (!sanitized.id && sanitized.email) {
    sanitized.id = sanitized.email.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Build fullName from parts if not present
  if (!sanitized.fullName && (sanitized.firstName || sanitized.lastName)) {
    sanitized.fullName = [sanitized.firstName, sanitized.lastName].filter(Boolean).join(' ');
  }

  // Remove any field with forbidden key patterns
  for (const key of Object.keys(sanitized)) {
    const keyLower = key.toLowerCase();
    for (const pattern of forbiddenKeyPatterns) {
      if (keyLower.includes(pattern)) {
        delete sanitized[key];
        break;
      }
    }
  }

  // Remove any field whose string value contains forbidden patterns
  for (const key of Object.keys(sanitized)) {
    const value = sanitized[key];
    if (typeof value === 'string') {
      const valueLower = value.toLowerCase();
      for (const pattern of forbiddenValuePatterns) {
        if (valueLower.includes(pattern)) {
          delete sanitized[key];
          break;
        }
      }
    }
  }

  // Set branded source fields (ALWAYS override any existing source info)
  sanitized.source = 'Perception Labs';
  sanitized.provider = 'BookedService Intelligence';
  sanitized.deliveredAt = new Date().toISOString();

  return sanitized;
}

/**
 * Final sanitization pass on JSON string before sending to client.
 * Removes any residual upstream vendor references that may have slipped through.
 *
 * @param {Object} data - The data object to sanitize
 * @returns {string} - Sanitized JSON string
 */
function sanitizeJsonResponse(data) {
  let jsonString = JSON.stringify(data);

  // Remove any occurrence of upstream vendor names (case-insensitive)
  // Covers: audiencelab, audiencelabs, audience_lab, audience_labs, audiencelab.io
  jsonString = jsonString.replace(/audiencelab(s)?/gi, '[REDACTED]');
  jsonString = jsonString.replace(/audience_lab(s)?/gi, '[REDACTED]');
  jsonString = jsonString.replace(/audiencelab\.io/gi, '[REDACTED]');
  jsonString = jsonString.replace(/api\.audiencelab/gi, 'api.[REDACTED]');

  return jsonString;
}

// =============================================================================
// Scheduled Cloud Function: syncLeads
// Runs every 24 hours to fetch and sanitize leads from upstream
// =============================================================================

// Upstream API configuration (AudienceLab)
const UPSTREAM_API_BASE = 'https://api.audiencelab.io';

// Audience IDs to sync (can be configured via functions.config().audiences.ids)
const getAudienceIds = () => {
  const configIds = functions.config().audiences?.ids;
  if (configIds) {
    return configIds.split(',').map(id => id.trim());
  }
  // Default audience IDs - configure these via firebase functions:config:set
  return process.env.AUDIENCE_IDS?.split(',').map(id => id.trim()) || [];
};

/**
 * Fetch all leads from a single audience with pagination
 */
async function fetchAudienceLeads(audienceId) {
  const allLeads = [];
  let page = 1;
  const pageSize = 1000; // Max allowed by API
  let hasMore = true;

  while (hasMore) {
    const response = await axios.get(`${UPSTREAM_API_BASE}/audiences/${audienceId}`, {
      headers: {
        'X-Api-Key': AUDIENCELABS_API_KEY,
        'Content-Type': 'application/json'
      },
      params: {
        page,
        page_size: pageSize
      }
    });

    const { data, total_pages } = response.data;

    if (data && data.length > 0) {
      allLeads.push(...data);
    }

    hasMore = page < total_pages;
    page++;
  }

  return allLeads;
}

exports.syncLeads = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const syncStartTime = new Date();
    let leadsDelivered = 0;
    let status = 'success';
    let errorMessage = null;

    try {
      if (!AUDIENCELABS_API_KEY) {
        throw new Error('Upstream API key not configured');
      }

      const audienceIds = getAudienceIds();
      if (audienceIds.length === 0) {
        throw new Error('No audience IDs configured. Set via AUDIENCE_IDS env or firebase config.');
      }

      console.log(`Starting sync for ${audienceIds.length} audiences...`);

      // Fetch leads from each configured audience
      for (const audienceId of audienceIds) {
        try {
          console.log(`Fetching audience: ${audienceId}`);
          const rawLeads = await fetchAudienceLeads(audienceId);
          console.log(`Retrieved ${rawLeads.length} leads from audience`);

          // Process each lead
          for (const rawLead of rawLeads) {
            try {
              // Sanitize the lead before any write
              const sanitizedLead = sanitizeLead(rawLead);

              // Determine client ID (use audience ID or default)
              const clientId = rawLead.clientId || 'default';
              const leadId = sanitizedLead.id ||
                rawLead.email?.replace(/[^a-zA-Z0-9]/g, '_') ||
                admin.firestore().collection('temp').doc().id;

              // Write to Firestore with merge
              await db
                .collection('leads')
                .doc(clientId)
                .collection('contacts')
                .doc(leadId)
                .set(sanitizedLead, { merge: true });

              leadsDelivered++;
            } catch (leadError) {
              console.error('Error processing individual lead:', leadError.message);
            }
          }
        } catch (audienceError) {
          console.error(`Error fetching audience ${audienceId}:`,
            audienceError.message.replace(/audiencelab/gi, '[upstream]'));
        }
      }

      console.log(`Sync completed: ${leadsDelivered} leads delivered`);

    } catch (error) {
      status = 'error';
      // Sanitize error message to never expose upstream vendor names or API keys
      errorMessage = error.message
        .replace(/audiencelab/gi, '[upstream]')
        .replace(/audience_lab/gi, '[upstream]')
        .replace(/audiencelabs/gi, '[upstream]')
        .replace(/audience_labs/gi, '[upstream]')
        .replace(new RegExp(AUDIENCELABS_API_KEY || 'no-key', 'g'), '[REDACTED]');

      console.error('Sync failed:', errorMessage);
    }

    // Write audit log
    try {
      await db.collection('audit').doc('syncLog').set({
        lastSync: syncStartTime.toISOString(),
        leadsDelivered,
        status,
        errorMessage
      });
    } catch (auditError) {
      console.error('Failed to write audit log:', auditError.message);
    }

    return null;
  });

// =============================================================================
// HTTPS Cloud Function: api
// Express-based API for lead retrieval with Bearer token authentication
// =============================================================================

const app = express();

// Middleware: Parse JSON
app.use(express.json());

// Middleware: Validate Bearer token
const validateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const validToken = functions.config().api?.client_token;

  if (!validToken || token !== validToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

// GET /v1/leads - Retrieve leads for a client
app.get('/v1/leads', validateToken, async (req, res) => {
  try {
    // Get client ID from header
    const clientId = req.headers['x-client-id'];

    if (!clientId) {
      return res.status(400).json({ error: 'X-Client-ID header required' });
    }

    // Query Firestore for client's leads
    const snapshot = await db
      .collection('leads')
      .doc(clientId)
      .collection('contacts')
      .orderBy('deliveredAt', 'desc')
      .limit(100)
      .get();

    const leads = [];
    snapshot.forEach(doc => {
      // Run sanitization again on each lead before delivery
      const leadData = doc.data();
      leads.push(sanitizeLead(leadData));
    });

    // Build response
    const responseData = {
      leads,
      source: 'Perception Labs',
      generatedAt: new Date().toISOString()
    };

    // Final sanitization pass on entire JSON response
    const sanitizedJson = sanitizeJsonResponse(responseData);

    res.setHeader('Content-Type', 'application/json');
    res.send(sanitizedJson);

  } catch (error) {
    console.error('API error:', error.message);
    res.status(500).json({
      error: 'Internal server error',
      source: 'Perception Labs'
    });
  }
});

// Health check endpoint
app.get('/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    source: 'Perception Labs',
    timestamp: new Date().toISOString()
  });
});

// Export the Express app as a Cloud Function
exports.api = functions.https.onRequest(app);
