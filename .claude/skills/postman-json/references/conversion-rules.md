# Conversion Rules & Validation Checklist

How to map each Markdown column to Postman fields, and how to verify the output before saving.

---

## Column → Postman field mapping

| Markdown column | Postman field | Transformation rules |
|---|---|---|
| TC_ID | `item.name` (prefix) | Prepend to description: `"TC_USERS_POST_001 — <Description>"` |
| Module | Top-level folder name | Used as folder hierarchy level 1 |
| Endpoint | Mid-level folder name | Format: `"<METHOD> <path>"` (e.g., `"POST /api/users"`) |
| Method | `request.method` | Uppercase HTTP verb |
| Test Type | Bottom-level folder name | One of: Happy, Validation, Auth, NotFound, Boundary, Security |
| Priority | (not in Postman) | Add as comment in test script: `// Priority: P1` |
| Pre-condition | `request.description` | Prepend as note |
| Description | `item.name` (suffix) | Used in request name after TC_ID |
| Headers | `request.header[]` + `request.auth` | Parse each line (`Key: Value`); `Authorization: Bearer/Basic user:pass` becomes request auth (see SKILL.md "Negative auth tests") |
| Path/Query Params | `url.path[]` + `url.query[]` | Path params substituted into URL; query params into query array; values percent-encoded (`{{vars}}` and `%XX` kept); `key` without `=` is a flag |
| Request Body | `request.body` | Strip backticks; mode chosen by the row's Content-Type: formdata / urlencoded / raw xml / raw text / raw json (SKILL.md "Request body") |
| Expected Status | First `pm.test()` assertion | `pm.response.to.have.status(<N>)`; several codes → one-of |
| Expected Response | Additional `pm.test()` assertions | Assertion clauses (field type/value/absence, header clauses, keyword phrases); plus a schema check from the spec |
| Notes | `request.description` + directives | `Save ...`, `[ORDER: ...]`, `[MAX-TIME: ms]`, `[NO-SCHEMA]`; also appended to description |

---

## Parsing the input Markdown

### Detecting tables

Tables are rows of the form `| cell | cell | ... |` separated from headers by `| --- | --- | ... |`.

After detecting a header row, take the cells in order to determine column positions. The header order in the api-test-design template is:

`TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes`

If the order differs (user customization), match by header name, not position. (Note: `scripts/generate-postman.js` currently maps by position, so keep the standard order.)

### Pipes inside cells

Rows are split on unescaped `|` only. A literal pipe inside a cell must be written as `\|` (e.g. `` `{"name":"a \| cat /etc/passwd"}` ``) and is restored to `|` after splitting. A row that does not split into exactly 14 cells produces a `[WARN] ... row has N cells, expected 14` line — the generated request for that row is wrong until the source is fixed.

### Handling multi-line cells

Cells with `<br>` represent multiple values on separate lines:

```
`Authorization: Bearer {{token}}`<br>`Content-Type: application/json`
```

Split by `<br>`, strip backticks, parse each as `Key: Value` for headers (or `Key=Value` for params).

### Handling code-block cells

Cells like `` `{"name":"Jane"}` `` are inline code. Strip surrounding backticks, then parse the inner content as JSON. If parsing fails, keep as raw string and add a TODO comment.

### Section headers

`## Module: Users` sets the module name for all subsequent tables until the next `## Module:` header. If no module header exists, use the value from the Module column.

### [NEEDS REVIEW] markers

When a cell contains `[NEEDS REVIEW]`:
- Generate the request with the literal text as a placeholder value
- Add `// TODO: [NEEDS REVIEW]` comment in the test script
- Mention these in the final user-facing summary

---

## Mapping examples

### Headers cell

Input cell:
```
`Authorization: Bearer {{token}}`<br>`Content-Type: application/json`
```

Output:
```json
"header": [
  { "key": "Authorization", "value": "Bearer {{token}}", "type": "text" },
  { "key": "Content-Type", "value": "application/json", "type": "text" }
]
```

### Path/Query Params cell

Input cell:
```
`userId=12345`<br>`include=profile`
```

For a URL `/api/users/{userId}`:
- `userId=12345` is a path param → substitute into path
- `include=profile` is a query param → add to query array

Output URL:
```json
"url": {
  "raw": "{{baseUrl}}/api/users/12345?include=profile",
  "host": ["{{baseUrl}}"],
  "path": ["api", "users", "12345"],
  "query": [
    { "key": "include", "value": "profile" }
  ]
}
```

Determining path vs query: if the param name appears in the endpoint path as `{name}`, it's a path param; otherwise, query.

### Request Body cell

Input cell:
```
`{"email":"jane@example.com","password":"SecurePass123"}`
```

Output:
```json
"body": {
  "mode": "raw",
  "raw": "{\"email\":\"jane@example.com\",\"password\":\"SecurePass123\"}",
  "options": { "raw": { "language": "json" } }
}
```

If the cell says `N/A` or is empty: omit the `body` field entirely.

If the body is invalid JSON (e.g., malformed JSON security test):
```
`{"name": "test"  ← intentionally malformed`
```
Keep the literal raw string. The malformed JSON is intentional — Postman sends it as-is.

### Expected Response cell

Input cell:
```
Response contains 'id' (integer), 'email' (string)
```

Generated assertions:
```javascript
pm.test("Response has 'id' field", function () {
    const json = pm.response.json();
    pm.expect(json).to.have.property("id");
    pm.expect(json.id).to.be.a("number");
});

pm.test("Response has 'email' field", function () {
    const json = pm.response.json();
    pm.expect(json).to.have.property("email");
    pm.expect(json.email).to.be.a("string");
});
```

The field name may be wrapped in single quotes (`'id'`), double quotes (`"id"`) or backticks (`` `id` ``), followed by the type hint in parentheses. Nested paths are allowed (`'data.token' (string)`).

When the row is `Happy`, method `POST`, expected status 2xx and the response text mentions `id`, the script also saves the created id to `{{<singular-module>Id}}` (module `Users` → `userId`), reading `json.id`, then `json.data.id`, then `json.<singular>.id`.

Type mapping for assertions:
- "integer", "int", "number" → `"number"`
- "string", "text" → `"string"`
- "boolean", "bool" → `"boolean"`
- "array", "list" → use `pm.expect(x).to.be.an("array")`
- "object" → use `pm.expect(x).to.be.an("object")`

If `[NEEDS REVIEW]`: only generate the status code assertion, add TODO.

---

## Variable extraction

Walk the generated collection JSON and find all `{{xxx}}` patterns. Collect into a set. Compare against the standard variables list (baseUrl, token); add any new ones to the environment file.

Pattern: `/\{\{(\w+)\}\}/g` to extract variable names.

Apply to:
- All header values
- All URL parts (raw, host elements, path elements, query values)
- Request body raw string
- Pre-request and test script content (but these are usually fine since they reference env vars that already exist)

---

## Validation checklist (run before saving)

### Schema validation

- [ ] `info.name` is non-empty string
- [ ] `info.schema` exactly equals `"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"`
- [ ] `info._postman_id` is a valid UUID
- [ ] `item` is an array with at least one element

### Per-request validation

For each leaf request (no nested `item`):
- [ ] `request.method` is uppercase HTTP verb
- [ ] `request.url` is an object (not string) with `raw`, `host`, `path`
- [ ] `request.url.host` is an array
- [ ] `request.url.path` is an array
- [ ] If `request.body` exists, `body.mode` is set
- [ ] Each header in `request.header` has `key` and `value`
- [ ] `event` array exists with at least one `listen: "test"` script
- [ ] Multipart rows use `formdata` with no hand-written `Content-Type` (unless it carries a boundary); every `@file:` source is reported to the user
- [ ] No query value contains a raw `&`, `#`, `+` or space (they must be percent-encoded)
- [ ] When a spec was given: the summary line `Schema checks: N request(s)` is plausible (rows whose endpoint is not in the spec are listed in a warning)

### Environment validation

- [ ] `id` is a valid UUID
- [ ] `name` is non-empty
- [ ] `values` is an array
- [ ] Every `{{var}}` referenced in the collection has a matching entry in `values`
- [ ] No real tokens or production secrets are present (all secret-type vars have empty value)

### Sanity checks

- [ ] Request count matches input test case count (no rows dropped)
- [ ] TC_IDs are unique (the script warns on duplicates)
- [ ] Every row split into exactly 14 cells (the script warns otherwise)
- [ ] No URL still contains a single-brace placeholder like `{id}` (the script converts these to `{{id}}` and warns)
- [ ] Every `[WARN]` line from the script has been relayed to the user
- [ ] JSON parses without errors (use `JSON.parse()` in validation)
- [ ] Folder structure follows Module > Endpoint > Test Type exactly

---

## Generation approach

**Do not write a new Python/Node script for this** — `scripts/generate-postman.js` (see the skill's main SKILL.md, section "Generation method") already implements the flow below end-to-end: parse the Markdown → group by module/endpoint/test_type → build the collection structure → extract variables and build the environment → validate → save both files. Always invoke that script rather than reimplementing this logic ad hoc; if it's missing a case, extend that file instead of creating a parallel one.

The steps below document what the script does internally, for reference when verifying its output or extending it:

1. Parse the Markdown file into a list of test_case rows.
2. Group by module > endpoint > test_type.
3. Build the collection structure (`info`, collection-level `auth`, `item` tree).
4. Extract `{{variables}}` and build the environment file.
5. Validate (schema fields present, JSON parses, no dropped rows).
6. Save both files to the output directory.

---

## Common pitfalls

1. **URL as string instead of object** — Postman v2.1 requires the URL object form; string URLs may not parse path/query correctly.
2. **Body raw not stringified** — `body.raw` must be a JSON string, not an embedded object.
3. **Script exec as single string** — Must be an array of lines, one string per line.
4. **Missing schema field** — Without `info.schema`, Postman may refuse to import.
5. **UUID collisions** — Don't reuse the same UUID for collection and environment.
6. **Variable defined but not in environment** — Postman shows red highlight; the request still runs but with empty value.
7. **Auth on 401 tests** — If auth is set at collection level and a 401 test inherits it, the test will fail. Override with `auth: { type: "noauth" }` at request level. Also never keep a `Authorization` header in `request.header` while request/collection auth is active — the header would be sent twice. See the auth table in SKILL.md ("Negative auth tests").
8. **Top-level `pm.response.json()`** — Throws on a non-JSON body (204, HTML error page) and aborts every assertion after it. Parse once with `try/catch` into `json` (null on failure).
