# Postman Collection v2.1 Schema

Read this file when constructing the collection JSON. It defines the exact structure required for Postman to import the file cleanly.

## Top-level structure

```json
{
  "info": {
    "_postman_id": "<UUID>",
    "name": "<collection name>",
    "description": "<optional>",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    /* folders or requests */
  ],
  "auth": { /* collection-level auth, optional */ },
  "event": [ /* collection-level pre-request/test scripts, optional */ ],
  "variable": [ /* collection variables, optional */ ]
}
```

**Required fields**: `info.name`, `info.schema`, `item`.

**`_postman_id`**: A UUID v4. Generate one randomly when creating the collection. Example: `"550e8400-e29b-41d4-a716-446655440000"`.

---

## Folder (item with sub-items)

A folder is just an `item` that itself contains an `item` array:

```json
{
  "name": "Users",
  "item": [
    {
      "name": "POST /api/users",
      "item": [
        {
          "name": "Happy",
          "item": [
            /* requests here */
          ]
        }
      ]
    }
  ]
}
```

Folders can nest arbitrarily deep. We use 3 levels: Module → Endpoint → Test Type.

---

## Request item

```json
{
  "name": "TC_USERS_POST_001 — Create user with valid data",
  "request": {
    "method": "POST",
    "header": [
      {
        "key": "Content-Type",
        "value": "application/json",
        "type": "text"
      }
    ],
    "body": {
      "mode": "raw",
      "raw": "{\"email\":\"jane@example.com\",\"password\":\"SecurePass123\"}",
      "options": {
        "raw": {
          "language": "json"
        }
      }
    },
    "url": {
      "raw": "{{baseUrl}}/api/users",
      "host": ["{{baseUrl}}"],
      "path": ["api", "users"]
    },
    "auth": { /* optional, overrides collection auth */ },
    "description": "Optional request description"
  },
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "pm.test(\"Status code is 201\", function () {",
          "    pm.response.to.have.status(201);",
          "});"
        ],
        "type": "text/javascript"
      }
    }
  ]
}
```

---

## URL parsing rules

Postman v2.1 splits URLs into structured parts. **Do not just emit a string** — parse properly:

### Plain path
URL: `{{baseUrl}}/api/users`
```json
{
  "raw": "{{baseUrl}}/api/users",
  "host": ["{{baseUrl}}"],
  "path": ["api", "users"]
}
```

### Path with parameter
URL: `{{baseUrl}}/api/users/{{userId}}`
```json
{
  "raw": "{{baseUrl}}/api/users/{{userId}}",
  "host": ["{{baseUrl}}"],
  "path": ["api", "users", "{{userId}}"]
}
```

### With query parameters
URL: `{{baseUrl}}/api/users?page=1&limit=20`
```json
{
  "raw": "{{baseUrl}}/api/users?page=1&limit=20",
  "host": ["{{baseUrl}}"],
  "path": ["api", "users"],
  "query": [
    { "key": "page", "value": "1" },
    { "key": "limit", "value": "20" }
  ]
}
```

### Disabled query parameter (commented out)
```json
{
  "query": [
    { "key": "debug", "value": "true", "disabled": true }
  ]
}
```

**Important**: `host` is always an array. For `{{baseUrl}}` variable, the array is `["{{baseUrl}}"]` (single element). For a literal host like `api.example.com`, split by dot: `["api", "example", "com"]`.

---

## Headers

Each header is an object:
```json
{
  "key": "Authorization",
  "value": "Bearer {{token}}",
  "type": "text",
  "disabled": false
}
```

Set `"disabled": true` to include a header that is commented out (useful for showing alternative auth in 401 tests).

---

## Request body modes

### Raw JSON (most common)
```json
{
  "mode": "raw",
  "raw": "{\"key\":\"value\"}",
  "options": {
    "raw": { "language": "json" }
  }
}
```

Important: The `raw` field is a **string**, not an object. JSON content must be stringified.

### Form-data (file upload, multipart)
```json
{
  "mode": "formdata",
  "formdata": [
    { "key": "file", "type": "file", "src": "/path/to/file" },
    { "key": "name", "value": "test", "type": "text" }
  ]
}
```

### URL-encoded
```json
{
  "mode": "urlencoded",
  "urlencoded": [
    { "key": "username", "value": "jane", "type": "text" }
  ]
}
```

### No body
Omit the `body` field entirely. Do NOT emit `"body": null` or `"body": {}`.

---

## Auth schemes

### Collection-level (Bearer token)
At the collection root:
```json
{
  "info": { ... },
  "auth": {
    "type": "bearer",
    "bearer": [
      { "key": "token", "value": "{{token}}", "type": "string" }
    ]
  },
  "item": [ ... ]
}
```

Individual requests inherit this auth automatically.

### Request-level override (no auth for 401 tests)
```json
{
  "request": {
    "auth": { "type": "noauth" },
    ...
  }
}
```

### Other schemes
- `"type": "basic"` — Basic auth
- `"type": "apikey"` — API key
- `"type": "oauth2"` — OAuth 2.0

---

## Event scripts

Test scripts and pre-request scripts are attached via `event`:

```json
"event": [
  {
    "listen": "prerequest",
    "script": {
      "exec": ["console.log('Before request');"],
      "type": "text/javascript"
    }
  },
  {
    "listen": "test",
    "script": {
      "exec": [
        "pm.test(\"Status is 200\", function () {",
        "    pm.response.to.have.status(200);",
        "});"
      ],
      "type": "text/javascript"
    }
  }
]
```

**Important**: `script.exec` is an **array of strings**, one per line. Do not put `\n` in single strings.

---

## Complete minimal example

```json
{
  "info": {
    "_postman_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Example API Tests",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": {
    "type": "bearer",
    "bearer": [
      { "key": "token", "value": "{{token}}", "type": "string" }
    ]
  },
  "item": [
    {
      "name": "Users",
      "item": [
        {
          "name": "POST /api/users",
          "item": [
            {
              "name": "Happy",
              "item": [
                {
                  "name": "TC_USERS_POST_001 — Create user with valid data",
                  "request": {
                    "method": "POST",
                    "header": [
                      { "key": "Content-Type", "value": "application/json", "type": "text" }
                    ],
                    "body": {
                      "mode": "raw",
                      "raw": "{\"email\":\"jane@example.com\",\"password\":\"SecurePass123\"}",
                      "options": { "raw": { "language": "json" } }
                    },
                    "url": {
                      "raw": "{{baseUrl}}/api/users",
                      "host": ["{{baseUrl}}"],
                      "path": ["api", "users"]
                    }
                  },
                  "event": [
                    {
                      "listen": "test",
                      "script": {
                        "exec": [
                          "pm.test(\"Status code is 201\", function () {",
                          "    pm.response.to.have.status(201);",
                          "});",
                          "",
                          "pm.test(\"Response has user id\", function () {",
                          "    const json = pm.response.json();",
                          "    pm.expect(json).to.have.property('id');",
                          "});",
                          "",
                          "// Save ID for chained tests",
                          "const json = pm.response.json();",
                          "if (json && json.id) {",
                          "    pm.environment.set('userId', json.id);",
                          "}"
                        ],
                        "type": "text/javascript"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Validate the output against this structure before saving.
