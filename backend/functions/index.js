require('dotenv').config();

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const axios = require('axios');
const express = require('express');

// =============================================================================
// Environment Variables - Read from process.env ONLY, never hardcoded
// =============================================================================

const UPSTREAM_API_KEY = process.env.AUDIENCELABS_API_KEY || functions.config().upstream?.api_key;
const GHL_API_KEY = process.env.GHL_API_KEY || functions.config().ghl?.api_key;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || functions.config().ghl?.location_id || '5YbjlcKXIclpwGtW774o';

// Upstream API configuration
const UPSTREAM_API_BASE = 'https://api.audiencelab.io';

if (!UPSTREAM_API_KEY) {
  console.error('[Perception Labs] FATAL: Upstream API key not configured');
}
if (!GHL_API_KEY) {
  console.error('[Perception Labs] WARNING: GHL API key not configured');
}

// =============================================================================
// Firebase Admin Initialization
// =============================================================================

const serviceAccountPath = process.env.GOOGLE_API_KEY;
let serviceAccount = null;

if (serviceAccountPath) {
  try {
    serviceAccount = require(serviceAccountPath);
  } catch (e) {
    console.log('[Perception Labs] Using application default credentials');
  }
}

admin.initializeApp(
  serviceAccount
    ? { credential: admin.credential.cert(serviceAccount) }
    : { credential: admin.credential.applicationDefault() }
);

const db = admin.firestore();

// =============================================================================
// GHL Custom Field Keys (Leadtapp Agent KPIs)
// =============================================================================

const GHL_CUSTOM_FIELDS = {
  leadtappAgentId: 'leadtapp_agent_id',
  leadsDelivered: 'leads_delivered',
  leadsCalled: 'leads_called',
  appointmentRate: 'appointment_rate',
  avgCallDuration: 'avg_call_duration',
  lastActiveDate: 'last_active_date',
  assignedLcNumber: 'assigned_lc_number',
  kwCommandId: 'kw_command_id',
  bestLeadTypes: 'best_lead_types',
  trainingRecommended: 'training_recommended'
};

// =============================================================================
// LEAD SANITIZATION - Strips all upstream vendor references
// =============================================================================

/**
 * Sanitizes a raw lead object for Perception Labs branding.
 * Removes all upstream vendor information.
 */
function sanitizeLead(rawLead) {
  // Field mapping from various upstream formats
  const fieldMapping = {
    'id': 'id',
    'address': 'address',
    'Address': 'address',
    'street_address': 'address',
    'property_address': 'address',
    'city': 'city',
    'City': 'city',
    'state': 'state',
    'State': 'state',
    'zip': 'zip',
    'Zip': 'zip',
    'zip_code': 'zip',
    'postal_code': 'zip',
    'property_type': 'propertyType',
    'propertyType': 'propertyType',
    'PropertyType': 'propertyType',
    'estimated_value': 'estimatedValue',
    'estimatedValue': 'estimatedValue',
    'home_value': 'estimatedValue',
    'property_value': 'estimatedValue',
    'owner_name': 'ownerName',
    'ownerName': 'ownerName',
    'full_name': 'ownerName',
    'name': 'ownerName',
    'firstName': 'firstName',
    'first_name': 'firstName',
    'lastName': 'lastName',
    'last_name': 'lastName',
    'phone': 'phone',
    'Phone': 'phone',
    'phone_number': 'phone',
    'email': 'email',
    'Email': 'email',
    'lead_score': 'leadScore',
    'leadScore': 'leadScore',
    'score': 'leadScore'
  };

  // Forbidden patterns (upstream vendor references)
  const forbiddenPatterns = [
    'audiencelab', 'audience_lab', 'audiencelabs', 'audience_labs',
    'vendor', 'supplier', 'apiprovider', 'apikey', 'upstream', 'source_id'
  ];

  const sanitized = {};

  // Map fields
  for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
    if (rawLead[sourceField] !== undefined && rawLead[sourceField] !== null && rawLead[sourceField] !== '') {
      sanitized[targetField] = rawLead[sourceField];
    }
  }

  // Generate ID if not present
  if (!sanitized.id) {
    sanitized.id = db.collection('leads').doc().id;
  }

  // Build ownerName from parts if needed
  if (!sanitized.ownerName && (sanitized.firstName || sanitized.lastName)) {
    sanitized.ownerName = [sanitized.firstName, sanitized.lastName].filter(Boolean).join(' ');
  }

  // Remove firstName/lastName after merging (keep ownerName only)
  delete sanitized.firstName;
  delete sanitized.lastName;

  // Remove any field with forbidden patterns in key or value
  for (const key of Object.keys(sanitized)) {
    const keyLower = key.toLowerCase();
    const value = sanitized[key];
    const valueLower = typeof value === 'string' ? value.toLowerCase() : '';

    for (const pattern of forbiddenPatterns) {
      if (keyLower.includes(pattern) || valueLower.includes(pattern)) {
        delete sanitized[key];
        break;
      }
    }
  }

  // Set required fields with defaults
  sanitized.status = 'new';
  sanitized.assignedAgentId = null;
  sanitized.createdAt = admin.firestore.FieldValue.serverTimestamp();
  sanitized.leadScore = sanitized.leadScore || 0;

  return sanitized;
}

/**
 * Final JSON sanitization before sending to clients
 */
function sanitizeJsonResponse(data) {
  let jsonString = JSON.stringify(data);
  jsonString = jsonString.replace(/audiencelab(s)?/gi, '[REDACTED]');
  jsonString = jsonString.replace(/audience_lab(s)?/gi, '[REDACTED]');
  return JSON.parse(jsonString);
}

// =============================================================================
// 1. LEAD INGESTION SERVICE (Scheduled - Daily)
// Fetches leads from upstream provider, sanitizes, and stores in Firestore
// =============================================================================

/**
 * Fetch leads from a single upstream audience with pagination
 */
async function fetchUpstreamLeads(audienceId) {
  const allLeads = [];
  let page = 1;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await axios.get(`${UPSTREAM_API_BASE}/audiences/${audienceId}`, {
        headers: {
          'X-Api-Key': UPSTREAM_API_KEY,
          'Content-Type': 'application/json'
        },
        params: { page, page_size: pageSize }
      });

      const { data, total_pages } = response.data;
      if (data && data.length > 0) {
        allLeads.push(...data);
      }
      hasMore = page < total_pages;
      page++;
    } catch (error) {
      console.error(`[Perception Labs] Error fetching page ${page}:`, error.message);
      hasMore = false;
    }
  }

  return allLeads;
}

/**
 * Get configured audience IDs
 */
function getAudienceIds() {
  const configIds = functions.config().audiences?.ids || process.env.AUDIENCE_IDS;
  if (configIds) {
    return configIds.split(',').map(id => id.trim()).filter(Boolean);
  }
  return [];
}

exports.ingestLeads = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const syncStartTime = new Date();
    let leadsIngested = 0;
    let status = 'success';
    let errorMessage = null;

    console.log('[Perception Labs] Starting daily lead ingestion...');

    try {
      if (!UPSTREAM_API_KEY) {
        throw new Error('Lead data source not configured');
      }

      const audienceIds = getAudienceIds();
      if (audienceIds.length === 0) {
        throw new Error('No data sources configured');
      }

      for (const audienceId of audienceIds) {
        console.log(`[Perception Labs] Processing source: ${audienceId.substring(0, 8)}...`);

        const rawLeads = await fetchUpstreamLeads(audienceId);
        console.log(`[Perception Labs] Retrieved ${rawLeads.length} records`);

        const batch = db.batch();
        let batchCount = 0;

        for (const rawLead of rawLeads) {
          const sanitizedLead = sanitizeLead(rawLead);
          const leadRef = db.collection('leads').doc(sanitizedLead.id);

          batch.set(leadRef, sanitizedLead, { merge: true });
          batchCount++;
          leadsIngested++;

          // Firestore batch limit is 500
          if (batchCount >= 500) {
            await batch.commit();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }
      }

      console.log(`[Perception Labs] Ingestion complete: ${leadsIngested} leads processed`);

    } catch (error) {
      status = 'error';
      errorMessage = error.message.replace(/audiencelab/gi, '[source]');
      console.error('[Perception Labs] Ingestion failed:', errorMessage);
    }

    // Write audit log
    await db.collection('audit').doc('ingestionLog').set({
      lastRun: syncStartTime.toISOString(),
      leadsIngested,
      status,
      errorMessage,
      service: 'Perception Labs Lead Ingestion'
    });

    return null;
  });

// =============================================================================
// 2. GHL SYNC SERVICE
// Syncs agent data to GoHighLevel CRM
// =============================================================================

/**
 * Upsert a contact in GHL
 */
async function upsertGhlContact(agentData) {
  if (!GHL_API_KEY) {
    throw new Error('GHL API not configured');
  }

  const contactPayload = {
    locationId: GHL_LOCATION_ID,
    firstName: agentData.firstName || agentData.name?.split(' ')[0] || '',
    lastName: agentData.lastName || agentData.name?.split(' ').slice(1).join(' ') || '',
    email: agentData.email,
    phone: agentData.phone,
    tags: ['Leadtapp Agent'],
    customFields: [
      { key: GHL_CUSTOM_FIELDS.leadtappAgentId, value: agentData.id },
      { key: GHL_CUSTOM_FIELDS.leadsDelivered, value: String(agentData.kpis?.leadsDelivered || 0) },
      { key: GHL_CUSTOM_FIELDS.leadsCalled, value: String(agentData.kpis?.leadsCalled || 0) },
      { key: GHL_CUSTOM_FIELDS.appointmentRate, value: String(agentData.kpis?.appointmentRate || 0) },
      { key: GHL_CUSTOM_FIELDS.avgCallDuration, value: String(agentData.kpis?.avgCallDuration || 0) },
      { key: GHL_CUSTOM_FIELDS.lastActiveDate, value: agentData.kpis?.lastActiveDate || '' },
      { key: GHL_CUSTOM_FIELDS.assignedLcNumber, value: agentData.lcNumber || '' },
      { key: GHL_CUSTOM_FIELDS.kwCommandId, value: agentData.kwCommandId || '' },
      { key: GHL_CUSTOM_FIELDS.bestLeadTypes, value: agentData.kpis?.bestLeadTypes || '' },
      { key: GHL_CUSTOM_FIELDS.trainingRecommended, value: agentData.kpis?.trainingRecommended ? 'Yes' : 'No' }
    ]
  };

  // Check if contact exists by email
  let ghlContactId = agentData.ghlContactId;

  if (!ghlContactId && agentData.email) {
    try {
      const searchResponse = await axios.get(
        `https://services.leadconnectorhq.com/contacts/search/duplicate`,
        {
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
          },
          params: {
            locationId: GHL_LOCATION_ID,
            email: agentData.email
          }
        }
      );
      ghlContactId = searchResponse.data?.contact?.id;
    } catch (e) {
      console.log('[Leadtapp] No existing GHL contact found, creating new');
    }
  }

  let response;
  if (ghlContactId) {
    // Update existing contact
    response = await axios.put(
      `https://services.leadconnectorhq.com/contacts/${ghlContactId}`,
      contactPayload,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );
  } else {
    // Create new contact
    response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactPayload,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );
  }

  return response.data?.contact?.id || ghlContactId;
}

exports.syncAgentToGHL = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { agentId } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId required' });
    }

    // Get agent from Firestore
    const agentDoc = await db.collection('agents').doc(agentId).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agentData = { id: agentId, ...agentDoc.data() };

    // Upsert to GHL
    const ghlContactId = await upsertGhlContact(agentData);

    // Store GHL Contact ID back to Firestore
    await db.collection('agents').doc(agentId).update({
      ghlContactId,
      ghlSyncedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[Leadtapp] Agent ${agentId} synced to GHL: ${ghlContactId}`);

    res.json({
      success: true,
      agentId,
      ghlContactId,
      message: 'Agent synced to GHL successfully'
    });

  } catch (error) {
    console.error('[Leadtapp] GHL sync error:', error.message);
    res.status(500).json({ error: 'Failed to sync agent to GHL' });
  }
});

// =============================================================================
// 3. LEAD DISTRIBUTION SERVICE
// Assigns leads to agents and updates KPIs
// =============================================================================

/**
 * Update agent's leads_delivered count in GHL
 */
async function incrementGhlLeadsDelivered(ghlContactId, newCount) {
  if (!GHL_API_KEY || !ghlContactId) return;

  try {
    await axios.put(
      `https://services.leadconnectorhq.com/contacts/${ghlContactId}`,
      {
        customFields: [
          { key: GHL_CUSTOM_FIELDS.leadsDelivered, value: String(newCount) }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('[Leadtapp] Failed to update GHL leads count:', error.message);
  }
}

exports.assignLead = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { leadId, agentId } = req.body;

    if (!leadId || !agentId) {
      return res.status(400).json({ error: 'leadId and agentId required' });
    }

    // Get lead
    const leadRef = db.collection('leads').doc(leadId);
    const leadDoc = await leadRef.get();

    if (!leadDoc.exists) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const leadData = leadDoc.data();

    if (leadData.assignedAgentId && leadData.assignedAgentId !== agentId) {
      return res.status(409).json({ error: 'Lead already assigned to another agent' });
    }

    // Get agent
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();

    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agentData = agentDoc.data();

    // Update lead
    await leadRef.update({
      assignedAgentId: agentId,
      status: 'assigned',
      assignedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Increment agent's leads delivered count
    const newLeadsDelivered = (agentData.kpis?.leadsDelivered || 0) + 1;
    await agentRef.update({
      'kpis.leadsDelivered': newLeadsDelivered,
      'kpis.lastActiveDate': new Date().toISOString()
    });

    // Update GHL
    if (agentData.ghlContactId) {
      await incrementGhlLeadsDelivered(agentData.ghlContactId, newLeadsDelivered);
    }

    console.log(`[Leadtapp] Lead ${leadId} assigned to agent ${agentId}`);

    // Return sanitized lead (no source metadata)
    const sanitizedResponse = sanitizeJsonResponse({
      success: true,
      lead: {
        id: leadData.id,
        address: leadData.address,
        city: leadData.city,
        state: leadData.state,
        zip: leadData.zip,
        propertyType: leadData.propertyType,
        estimatedValue: leadData.estimatedValue,
        ownerName: leadData.ownerName,
        phone: leadData.phone,
        leadScore: leadData.leadScore,
        status: 'assigned',
        assignedAgentId: agentId
      },
      agentId,
      leadsDelivered: newLeadsDelivered
    });

    res.json(sanitizedResponse);

  } catch (error) {
    console.error('[Leadtapp] Lead assignment error:', error.message);
    res.status(500).json({ error: 'Failed to assign lead' });
  }
});

// =============================================================================
// 5. API GATEWAY (Express)
// Protected routes for the Chrome extension
// =============================================================================

const app = express();
app.use(express.json());

/**
 * Firebase Auth ID Token verification middleware
 */
const verifyAuthToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('[Leadtapp API] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Apply auth middleware to all /api routes
app.use('/api', verifyAuthToken);

/**
 * GET /api/leads?agentId={id}
 * Returns assigned leads for an agent (no source metadata)
 */
app.get('/api/leads', async (req, res) => {
  try {
    const { agentId } = req.query;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId query parameter required' });
    }

    // Query leads assigned to this agent
    const leadsSnapshot = await db.collection('leads')
      .where('assignedAgentId', '==', agentId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const leads = [];
    leadsSnapshot.forEach(doc => {
      const data = doc.data();
      leads.push({
        id: doc.id,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        propertyType: data.propertyType,
        estimatedValue: data.estimatedValue,
        ownerName: data.ownerName,
        phone: data.phone,
        leadScore: data.leadScore,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        assignedAt: data.assignedAt?.toDate?.()?.toISOString() || null
      });
    });

    res.json(sanitizeJsonResponse({
      leads,
      count: leads.length,
      source: 'Perception Labs',
      generatedAt: new Date().toISOString()
    }));

  } catch (error) {
    console.error('[Leadtapp API] Get leads error:', error.message);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

/**
 * POST /api/callLog
 * Logs a call result and updates agent KPIs
 */
app.post('/api/callLog', async (req, res) => {
  try {
    const { agentId, leadId, duration, outcome, aiScriptUsed, notes } = req.body;

    if (!agentId || !leadId) {
      return res.status(400).json({ error: 'agentId and leadId required' });
    }

    // Create call log
    const callLogRef = db.collection('callLogs').doc();
    const callLogData = {
      id: callLogRef.id,
      agentId,
      leadId,
      duration: duration || 0,
      outcome: outcome || 'unknown',
      aiScriptUsed: aiScriptUsed || false,
      notes: notes || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      service: 'Leadtapp'
    };

    await callLogRef.set(callLogData);

    // Update agent KPIs
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();

    if (agentDoc.exists) {
      const agentData = agentDoc.data();
      const kpis = agentData.kpis || {};

      const newLeadsCalled = (kpis.leadsCalled || 0) + 1;
      const totalDuration = (kpis.totalCallDuration || 0) + (duration || 0);
      const newAvgDuration = Math.round(totalDuration / newLeadsCalled);

      // Count appointments
      let appointmentsSet = kpis.appointmentsSet || 0;
      if (outcome === 'appointment_set' || outcome === 'appointment') {
        appointmentsSet++;
      }
      const newAppointmentRate = Math.round((appointmentsSet / newLeadsCalled) * 100);

      await agentRef.update({
        'kpis.leadsCalled': newLeadsCalled,
        'kpis.totalCallDuration': totalDuration,
        'kpis.avgCallDuration': newAvgDuration,
        'kpis.appointmentsSet': appointmentsSet,
        'kpis.appointmentRate': newAppointmentRate,
        'kpis.lastActiveDate': new Date().toISOString()
      });

      // Sync updated KPIs to GHL
      if (agentData.ghlContactId) {
        try {
          await axios.put(
            `https://services.leadconnectorhq.com/contacts/${agentData.ghlContactId}`,
            {
              customFields: [
                { key: GHL_CUSTOM_FIELDS.leadsCalled, value: String(newLeadsCalled) },
                { key: GHL_CUSTOM_FIELDS.avgCallDuration, value: String(newAvgDuration) },
                { key: GHL_CUSTOM_FIELDS.appointmentRate, value: String(newAppointmentRate) },
                { key: GHL_CUSTOM_FIELDS.lastActiveDate, value: new Date().toISOString() }
              ]
            },
            {
              headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
              }
            }
          );
        } catch (ghlError) {
          console.error('[Leadtapp API] GHL KPI sync error:', ghlError.message);
        }
      }
    }

    // Update lead status
    await db.collection('leads').doc(leadId).update({
      status: 'contacted',
      lastContactedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastOutcome: outcome
    });

    res.json({
      success: true,
      callLogId: callLogRef.id,
      message: 'Call logged successfully'
    });

  } catch (error) {
    console.error('[Leadtapp API] Call log error:', error.message);
    res.status(500).json({ error: 'Failed to log call' });
  }
});

/**
 * GET /api/agent/:agentId
 * Returns agent profile and KPIs
 */
app.get('/api/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    const agentDoc = await db.collection('agents').doc(agentId).get();

    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const data = agentDoc.data();

    res.json(sanitizeJsonResponse({
      id: agentId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      lcNumber: data.lcNumber,
      kwCommandId: data.kwCommandId,
      kpis: {
        leadsDelivered: data.kpis?.leadsDelivered || 0,
        leadsCalled: data.kpis?.leadsCalled || 0,
        appointmentRate: data.kpis?.appointmentRate || 0,
        avgCallDuration: data.kpis?.avgCallDuration || 0,
        lastActiveDate: data.kpis?.lastActiveDate || null,
        bestLeadTypes: data.kpis?.bestLeadTypes || '',
        trainingRecommended: data.kpis?.trainingRecommended || false
      },
      ghlContactId: data.ghlContactId || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      source: 'Leadtapp'
    }));

  } catch (error) {
    console.error('[Leadtapp API] Get agent error:', error.message);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

/**
 * POST /api/agent
 * Creates a new agent profile
 */
app.post('/api/agent', async (req, res) => {
  try {
    const { name, email, phone, lcNumber, kwCommandId } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email required' });
    }

    const agentRef = db.collection('agents').doc();
    const agentData = {
      id: agentRef.id,
      name,
      email,
      phone: phone || '',
      lcNumber: lcNumber || '',
      kwCommandId: kwCommandId || '',
      kpis: {
        leadsDelivered: 0,
        leadsCalled: 0,
        appointmentRate: 0,
        avgCallDuration: 0,
        totalCallDuration: 0,
        appointmentsSet: 0,
        lastActiveDate: null,
        bestLeadTypes: '',
        trainingRecommended: false
      },
      ghlContactId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      service: 'Leadtapp'
    };

    await agentRef.set(agentData);

    console.log(`[Leadtapp] Created agent: ${agentRef.id}`);

    res.status(201).json({
      success: true,
      agentId: agentRef.id,
      message: 'Agent created successfully'
    });

  } catch (error) {
    console.error('[Leadtapp API] Create agent error:', error.message);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /api/stats
 * Returns overall system stats
 */
app.get('/api/stats', async (req, res) => {
  try {
    const [leadsSnapshot, agentsSnapshot, callLogsSnapshot] = await Promise.all([
      db.collection('leads').count().get(),
      db.collection('agents').count().get(),
      db.collection('callLogs').count().get()
    ]);

    res.json({
      totalLeads: leadsSnapshot.data().count,
      totalAgents: agentsSnapshot.data().count,
      totalCalls: callLogsSnapshot.data().count,
      source: 'Perception Labs',
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Leadtapp API] Stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Leadtapp API',
    timestamp: new Date().toISOString()
  });
});

// Export Express app as Cloud Function
exports.api = functions.https.onRequest(app);

// =============================================================================
// Manual Trigger for Lead Ingestion (for testing)
// =============================================================================

exports.triggerIngestion = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple API key check for manual triggers
  const apiKey = req.headers['x-api-key'];
  const validKey = functions.config().api?.admin_key || process.env.ADMIN_API_KEY;

  if (!validKey || apiKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Perception Labs] Manual ingestion triggered');

  // Run ingestion logic inline
  const syncStartTime = new Date();
  let leadsIngested = 0;

  try {
    if (!UPSTREAM_API_KEY) {
      throw new Error('Lead data source not configured');
    }

    const audienceIds = getAudienceIds();
    if (audienceIds.length === 0) {
      throw new Error('No data sources configured');
    }

    for (const audienceId of audienceIds) {
      const rawLeads = await fetchUpstreamLeads(audienceId);

      for (const rawLead of rawLeads) {
        const sanitizedLead = sanitizeLead(rawLead);
        await db.collection('leads').doc(sanitizedLead.id).set(sanitizedLead, { merge: true });
        leadsIngested++;
      }
    }

    res.json({
      success: true,
      leadsIngested,
      duration: `${(Date.now() - syncStartTime.getTime()) / 1000}s`,
      source: 'Perception Labs'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message.replace(/audiencelab/gi, '[source]'),
      leadsIngested
    });
  }
});
