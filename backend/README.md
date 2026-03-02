# Perception Labs Lead Intelligence

White-labeled lead delivery API for Chrome extensions. Upstream lead source is fully abstracted and never exposed to clients.

## Project Structure

```
backend/
  firebase.json          # Firebase configuration
  .firebaserc            # Firebase project settings
  firestore.rules        # Firestore security rules (deny all direct access)
  firestore.indexes.json # Firestore indexes
  functions/
    package.json         # Node.js dependencies
    .env.example         # Environment variable template
    index.js             # Cloud Functions (syncLeads, api)
  hosting/
    index.html           # Branded landing page
```

## Setup

### 1. Install Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 2. Create Firebase Project
```bash
firebase projects:create perception-labs-leads
firebase use perception-labs-leads
```

### 3. Create Environment File
```bash
cd backend/functions
cp .env.example .env
# Edit .env with your actual credentials
```

### 4. Set Firebase Config (for production)
```bash
firebase functions:config:set \
  audiencelabs.api_key="YOUR_AUDIENCELAB_API_KEY" \
  audiences.ids="uuid-1,uuid-2,uuid-3" \
  api.client_token="YOUR_CLIENT_BEARER_TOKEN"
```

### 5. Install Dependencies
```bash
cd backend/functions
npm install
```

### 6. Deploy
```bash
cd backend
firebase deploy
```

## API Usage

### GET /v1/leads

Retrieve leads for a client.

**Headers:**
- `Authorization: Bearer <client_token>` (required)
- `X-Client-ID: <client_id>` (required)

**Response:**
```json
{
  "leads": [
    {
      "id": "john_example_com",
      "firstName": "John",
      "lastName": "Doe",
      "fullName": "John Doe",
      "email": "john@example.com",
      "phone": "555-1234",
      "company": "Acme Inc",
      "jobTitle": "Manager",
      "city": "Austin",
      "state": "TX",
      "source": "Perception Labs",
      "provider": "BookedService Intelligence",
      "deliveredAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "source": "Perception Labs",
  "generatedAt": "2025-01-15T10:30:00.000Z"
}
```

### GET /v1/health

Health check endpoint (no authentication required).

## Security Features

- **White-labeling**: All upstream vendor references are stripped from leads
- **Firestore Rules**: Direct client SDK access is denied at all paths
- **Bearer Token Auth**: API requires valid token in Authorization header
- **Final Sanitization**: JSON responses are sanitized before sending
- **Audit Logging**: Sync operations are logged (without exposing vendor info)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUDIENCELABS_API_KEY` | AudienceLab API key (from https://build.audiencelab.io/api-keys) |
| `AUDIENCE_IDS` | Comma-separated list of audience UUIDs to sync |
| `GOOGLE_API_KEY` | Path to GCP service account JSON (optional for local dev) |

## Sync Schedule

The `syncLeads` function runs every 24 hours and:
1. Fetches leads from all configured AudienceLab audiences
2. Handles pagination automatically (up to 1000 per page)
3. Sanitizes all lead data to remove vendor references
4. Writes to Firestore at `/leads/{clientId}/contacts/{leadId}`
5. Logs sync status to `/audit/syncLog`

**Important:** Never commit `.env` files to version control.
