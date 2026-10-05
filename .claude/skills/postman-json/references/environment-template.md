# Postman Environment File Format

The environment file is a separate JSON file with the structure below. Postman imports it and lets users switch environments via the dropdown.

## Schema

```json
{
  "id": "<UUID>",
  "name": "<environment name>",
  "values": [
    {
      "key": "<variable name>",
      "value": "<default value or empty>",
      "type": "default" | "secret",
      "enabled": true
    }
  ],
  "_postman_variable_scope": "environment",
  "_postman_exported_at": "<ISO 8601 timestamp>",
  "_postman_exported_using": "Postman/10.0.0"
}
```

**Required fields**: `id`, `name`, `values`.

`id` is a UUID v4 (different from the collection's UUID).

`_postman_variable_scope`: Always `"environment"` for this skill's output.

---

## Variable types

- `"type": "default"` — Plain text, visible in UI
- `"type": "secret"` — Masked in UI (use for tokens, passwords, API keys)

`enabled: true` means the variable is active. Set `false` to keep a variable in the env but disable it.

---

## Standard variables to include

Every environment file should include these by default:

```json
{
  "id": "<UUID>",
  "name": "<API Name> - Local",
  "values": [
    {
      "key": "baseUrl",
      "value": "https://api.example.com",
      "type": "default",
      "enabled": true
    },
    {
      "key": "token",
      "value": "",
      "type": "secret",
      "enabled": true
    }
  ],
  "_postman_variable_scope": "environment",
  "_postman_exported_at": "2025-03-15T10:00:00.000Z",
  "_postman_exported_using": "Postman/10.0.0"
}
```

---

## Dynamic variables (added based on test cases)

Scan the test case file for all `{{xxx}}` references. For each unique reference not already in the standard list, add a variable.

Common dynamic variables:

| Variable name | Purpose | Default value | Type |
|---|---|---|---|
| `userId` | Populated by happy-path create-user test | `""` | default |
| `orderId` | Populated by happy-path create-order test | `""` | default |
| `productId` | Populated by happy-path create-product test | `""` | default |
| `expired_token` | Manually filled for expired-token tests | `""` (marked `[NEEDS REVIEW]`) | secret |
| `other_user_token` | Manually filled for 403 tests | `""` (marked `[NEEDS REVIEW]`) | secret |
| `dynamicEmail` | Set in pre-request scripts | `""` | default |

For variables that need manual fill, leave value empty AND add a note in the collection description so the user knows.

---

## Naming the environment file

Pattern: `<yyyy-mm-dd_hh-mm-ss>-<name>-environment.json`, next to `<yyyy-mm-dd_hh-mm-ss>-<name>-collection.json`; the timestamp is the local time of the run (see SKILL.md "Output deliverables").

Example (converted at 2026-10-04 17:05:12):
- Input: `2026-10-04_16-03-58-petstore-api.md`
- Collection: `2026-10-04_17-05-12-petstore-api-collection.json`
- Environment: `2026-10-04_17-05-12-petstore-api-environment.json`

The environment `name` field should be `"<API Name> - Local"` (suggesting it's the local/default env; user can duplicate for staging/production).

---

## Complete example

For an API with these test case references: `{{baseUrl}}`, `{{token}}`, `{{userId}}`, `{{orderId}}`, `{{expired_token}}`:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Users & Orders API - Local",
  "values": [
    {
      "key": "baseUrl",
      "value": "https://api.example.com",
      "type": "default",
      "enabled": true
    },
    {
      "key": "token",
      "value": "",
      "type": "secret",
      "enabled": true
    },
    {
      "key": "userId",
      "value": "",
      "type": "default",
      "enabled": true
    },
    {
      "key": "orderId",
      "value": "",
      "type": "default",
      "enabled": true
    },
    {
      "key": "expired_token",
      "value": "",
      "type": "secret",
      "enabled": true
    }
  ],
  "_postman_variable_scope": "environment",
  "_postman_exported_at": "2025-03-15T10:00:00.000Z",
  "_postman_exported_using": "Postman/10.0.0"
}
```

---

## Source the baseUrl from the right place

Priority order for finding the base URL:
1. Test case file metadata: `**Base URL**: \`https://...\`` line at the top
2. Source OpenAPI spec reference (look in the test case file header for spec path)
3. User confirmation if neither is available
4. Fallback: `https://api.example.com` with a `[NEEDS REVIEW]` note in the collection description

Never hardcode a real production URL the user didn't provide.
