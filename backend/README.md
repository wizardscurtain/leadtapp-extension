# Perception Labs Lead Intelligence

White-labeled lead delivery API for Chrome extensions. Upstream lead source is fully abstracted and never exposed to clients.

## Project Structure

```
/perception-labs-leads/
  firebase.json          # Firebase configuration
  .firebaserc            # Firebase project settings
  .gitignore             # Git ignore (includes .env files)
  firestore.rules        # Firestore security rules (deny all direct access)
  firestore.indexes.json # Firestore indexes
  /functions/
    package.json         # Node.js dependencies
    .env.example         # Environment variable template
    index.js             # Cloud Functions (syncLeads, api)
  /hosting/
    index.html           # Branded landing page
```

## Setup

### 1. Install Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 2. Create Environment File
```bash
cd functions
cp .env.example .env
# Edit .env with your actual credentials
```

### 3. Set Firebase Config (for production)
```bash
firebase functions:config:set \
  audiencelabs.api_key="YOUR_UPSTREAM_API_KEY" \
  gcp.api_key="/path/to/service-account.json" \
  api.client_token="YOUR_CLIENT_BEARER_TOKEN"
```

### 4. Install Dependencies
```bash
cd functions
npm install
```

### 5. Deploy
```bash
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
      "id": "abc123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "555-1234",
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
| `AUDIENCELABS_API_KEY` | Upstream lead data source API key |
| `GOOGLE_API_KEY` | Path to GCP service account JSON |

**Important:** Never commit `.env` files to version control.
