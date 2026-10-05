# Output Template — Markdown Table Format

Read this file when assembling the final output. It defines the exact file layout, column conventions, the **machine-readable conventions** that `postman-json` turns into assertions and variable chaining, and a worked example.

---

## File structure

```markdown
# API Test Cases — <API Title> v<Version>

**Source spec**: `<path or URL of the spec>`
**Generated**: <YYYY-MM-DD>
**Base URL**: `<chosen server URL>`
**Coverage depth**: Full | Lite
**Total test cases**: <N>

## Summary

| Module | Endpoints | Happy | Validation | Auth | NotFound | Boundary | Security | Total |
|---|---|---|---|---|---|---|---|---|
| Users | 4 | 8 | 20 | 16 | 4 | 18 | 14 | 80 |
| ... | | | | | | | | |

## Test data & pre-requisites

- Accounts / fixtures the run needs (role, how to obtain, environment variable), e.g. `{{token}}` — admin token saved by TC_AUTH_POST_001.
- Setup steps in order (e.g. reset database → log in as admin → log in as user).
- Environment variables that must be filled by hand: `{{expiredToken}}`, `{{tamperedToken}}`, ...

## Blocking items — resolve before running

Numbered list of `[NEEDS REVIEW]` items that break other rows if left unresolved (credentials, sample-data emails, ids that later rows depend on). Non-blocking `[NEEDS REVIEW]` items stay inline only.

## Assumptions

Bullet list of interpretations made where the spec was silent (status codes chosen by convention, exploratory limits, inferred business rules).

---

## Module: <Module Name>

### Endpoint: `<METHOD> <path>`

**Description**: <from spec>
**Auth required**: Yes (<scheme>, roles: <...>) / No
**Inputs**: <field — type, required/optional, constraints; one line per field>

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ... |

(repeat for each endpoint; endpoints inside a module in lifecycle order: create → read → update → delete; setup modules such as reset/login first)

---

## Coverage matrix

One table per module: rows = endpoint inputs (fields/params), columns = the checks applied; each cell lists the TC_IDs or `N/A (<reason>)`.

| Endpoint | Field | Missing/null | Wrong type | Format/enum/pattern | Boundary | Injection | Other |
|---|---|---|---|---|---|---|---|
| POST /api/users | email | TC_USERS_POST_004, _005 | TC_USERS_POST_009 | TC_USERS_POST_007 | TC_USERS_POST_015, _016 | TC_USERS_POST_024 | dup: TC_USERS_POST_010 |

## Not covered

Bullet list of everything intentionally left out, with the reason (e.g. "429 rate limiting — not declared in spec", "XML body — spec only accepts JSON", "race conditions — out of scope").
```

---

## Column conventions

| Column | Format | Example |
|---|---|---|
| TC_ID | `TC_<MODULE>_<METHOD>_<NNN>`; `<MODULE>` = Module uppercased (non-letters removed); `<NNN>` = 3-digit counter per `<MODULE>_<METHOD>` across the whole file (never restarts per endpoint) | `TC_USERS_POST_001` |
| Module | Tag name from spec, PascalCase | `Users` |
| Endpoint | Full path with `{placeholders}` exactly as in the spec | `/api/users/{id}` |
| Method | HTTP method, uppercase | `POST` |
| Test Type | Exactly one of: `Happy`, `Validation`, `Auth`, `NotFound`, `Boundary`, `Security` (no other values — `postman-json` builds folders from them). Side-effect rows use the type matching their own expected result | `Validation` |
| Priority | `P1` / `P2` / `P3` (see below) | `P1` |
| Pre-condition | Setup needed, incl. dependency TC_IDs, or `None` | `{{token}} from TC_AUTH_POST_001; user {{createdUserId}} exists (TC_USERS_POST_001)` |
| Description | One sentence: action + expected outcome | `Create user without 'email'; expect 400` |
| Headers | `Key: Value` in backticks, one per line separated by `<br>`. Credentials exactly as the spec's security scheme sends them (see "Auth schemes" below) | `` `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` `` |
| Path/Query Params | `key=value` in backticks, one per line with `<br>`; a key matching a `{placeholder}` in Endpoint is a path param, the rest are query params; a key without `=` is a valueless flag (`debug`). Give **every** path placeholder a value. Write payloads **unencoded** (`q=' OR 1=1 #`) — `postman-json` percent-encodes them; write `%XX` only when the test is about a pre-encoded value | `` `id={{createdUserId}}`<br>`include=profile` `` |
| Request Body | Single-line, in inline backticks, or `N/A`. JSON by default; for other content types see "Non-JSON bodies" below | `` `{"name":"Jane Doe","email":"jane@hoctest.com"}` `` |
| Expected Status | One code, or several separated by `/` when either is acceptable | `201` · `400/413` |
| Expected Response | Assertion clauses separated by `;` (syntax below), optionally followed by free text; or `[NEEDS REVIEW: ...]` | `` `success`=true; `user.id` (integer) `` |
| Notes | Assumptions, dependencies, `Save ... as ...` directives, `[SIDE-EFFECT]`, `[ORDER: ...]`, `[MAX-TIME: <ms>]` (own response-time limit, e.g. oversized payloads), `[NO-SCHEMA]` (skip the spec schema check for this row), or `N/A` | `` Save `user.id` as `{{createdUserId}}` `` |

---

## Machine-readable conventions (contract with `postman-json`)

`postman-json` generates `pm.test()` assertions **only** from the patterns below. Free-form text is kept for humans but produces no assertion beyond status code and response time — so express every important expectation with these patterns.

In addition, every row whose endpoint is in the spec gets an automatic **schema check**: the response JSON must match the schema the spec declares for the status code returned (types, required fields, enums, nullable). The `**Source spec**:` header line tells `postman-json` where the spec is — keep it accurate (path relative to the test case file, or a URL). So clauses only need to cover what a schema cannot: exact values, absence of secrets, headers, business rules.

### Expected Response — assertion clauses

| Write | Generated assertion |
|---|---|
| `` `success`=true `` / `` `success`=false `` | `json.success` equals the boolean |
| `` `message`="Exact text" `` | `json.message` equals the text exactly — use only when the spec gives the exact message |
| `` `user.email`="jane@hoctest.com" `` / `` `items[0].name`="Pen" `` | nested or indexed value equals a string (path must contain a `.` or `[n]`) |
| `` `data.count`=6 `` / `` `user.is_active`=true `` / `` `user.avatar`=null `` | nested value equals number / boolean / null |
| `` `user.id` (integer) `` | field present + type. Types: `integer`, `number`, `string`, `boolean`, `object`, `array`, `null`, `JWT string`, `User object`. Works for top-level (`` `token` (JWT string) ``) and nested paths |
| `` `users` is an array `` | field is an array |
| `` `password` not present in response `` / `` `user.password` absent `` | a bare key must not appear **anywhere** in the JSON (any depth); a dotted path checks exactly that path |
| `` `user.email`="jane+{{runId}}@hoctest.com" `` / `` `user.id`="{{createdUserId}}" `` | `{{variables}}` inside an equality value are resolved at run time; compared as strings, so numeric ids match too |
| `` header `Content-Type` contains "application/json" `` | response header contains the text (case-insensitive name and value) |
| `` header `Location` present `` / `` header `X-Powered-By` absent `` | header present / absent |
| `` header `Cache-Control` = "no-store" `` | header equals the text |
| `Error message indicates email is required` | response text contains `email` and/or `required` (also recognizes `invalid`, `not found`, `already exists`, `not allowed`) |
| `JSON parse error` | response text mentions json / parse / invalid |
| `no SQL error leaked` | response contains no SQL/DB error markers |
| `HTML-escaped or sanitized` | response does not contain the raw `<script>alert(1)</script>` — use only when the spec requires escaping |
| `unicode/emoji intact` | response is valid JSON (add an equality clause for the exact value) |
| `no unauthorized login granted` | `json.success` is not true |
| `no unintended rows deleted` | `json.success` is false |

Rules:
- When Expected Status lists several codes (`201/400`), only write clauses that hold for **all** of them; otherwise start the cell with `[NEEDS REVIEW: ...]` (which limits assertions to the status code) and describe the per-status expectation in words.
- Use **backticks** around field names. A top-level field other than `success`/`message` cannot take `=value`; use the type form or a nested path.
- `{{variables}}` may be used in string equality clauses (`` `profile.id`="{{createdUserId}}" ``) — the variable must be saved by an earlier row, be `{{runId}}`, or be listed as manual-fill.
- Prefer exact values the request controls (`` `user.name`="Nguyễn Văn An 😀" ``) over vague text ("name stored correctly").
- Express every sensitive-field check as an absence clause (`` `password` not present in response ``), so it is asserted automatically.

### Re-runnable data (`{{runId}}`)

Rows that create data under a uniqueness rule (email, username, slug, code) would fail with "already exists" on the second run if the value is fixed. Make such values unique per run with `{{runId}}` — `postman-json` sets it once at the start of every run:

- Body: `` `{"email":"jane+{{runId}}@hoctest.com","username":"jane_{{runId}}"}` ``
- Assert it back: `` `user.email`="jane+{{runId}}@hoctest.com" ``
- Duplicate-rule rows reuse the same value on purpose (send `jane+{{runId}}@hoctest.com` again → 400/409).

Keep fixed values for fields without a uniqueness rule, and for rows that must hit pre-existing sample data (login with the seeded admin).

### Notes — variable chaining (`Save` directive)

Any value a later row needs (tokens, created ids, emails) MUST be saved explicitly, in Notes (or Expected Response) of the row that produces it:

```
Save `data.token` as `{{token}}` and `data.user.id` as `{{adminId}}`
```

- Path = dot path into the JSON response; variable = `{{name}}`. Several pairs may follow one `Save`.
- Name the primary (admin/default) token `{{token}}` — it is the collection-level auth. Other roles: `{{userToken}}`, `{{otherUserToken}}`. Created ids: `{{created<Resource>Id}}`, e.g. `{{createdUserId}}`.
- Every `{{variable}}` used in a Headers/Params/Body cell must either be saved by an earlier row or be listed under "Test data & pre-requisites" as manual-fill.

### Long-string placeholder

Write long generated strings as `<N x 'c'>` inside the JSON string, e.g. `` `{"name":"<256 x 'a'>"}` `` or `<1048576 x 'a'>` for 1 MB. Do not write descriptions such as `<65-char string>` — they would be sent literally. `postman-json` expands `<N x 'c'>` at run time with a pre-request script.

### Non-JSON bodies

`postman-json` picks the body encoding from the row's `Content-Type` header, so always write that header for non-JSON bodies:

| Content-Type header | Request Body cell | Sent as |
|---|---|---|
| `multipart/form-data` | JSON object of form fields; a file field is `"@file:<path>"`; an array value repeats the field | form-data upload, e.g. `` `{"name":"Jane","avatar":"@file:test-files/avatar.png","tags":["a","b"]}` `` |
| `application/x-www-form-urlencoded` | JSON object, or `a=1&b=2` | form fields |
| `application/xml` / `text/xml` | the XML text | raw XML |
| `text/plain` or any other type | the text | raw, as written (also how "wrong Content-Type" tests work) |
| `application/json` or none | JSON (malformed JSON on purpose is fine) | raw JSON |

Upload files live in a `test-files/` folder next to the test case file (paths in `@file:` are relative to where Newman runs). List every file the rows need under "Test data & pre-requisites" (name, type, size, how to create it), and mark it blocking when it does not exist yet.

### Auth schemes

Write the credential exactly where the spec's `securitySchemes` puts it:

| Scheme | Valid credential | Notes |
|---|---|---|
| HTTP bearer / JWT / OAuth2 | `Authorization: Bearer {{token}}` | other roles `Bearer {{userToken}}`; negatives `Bearer invalid_token_xyz`, `Bearer {{expiredToken}}` |
| HTTP basic | `Authorization: Basic {{username}}:{{password}}` (plain `user:password`, `postman-json` base64-encodes it) | a pre-encoded `Basic <base64>` is sent verbatim — use it for malformed-credential tests |
| API key in header | `X-API-Key: {{apiKey}}` (the header name from the spec) | negatives: header missing, wrong key, key sent in the query instead |
| API key in query | `api_key={{apiKey}}` in Path/Query Params | negatives: param missing, wrong key, key sent as a header instead |
| Cookie session | `Cookie: session={{sessionId}}` (cookie name from the spec), saved from the login row | negatives: cookie missing, tampered value, value after logout |

### Table safety

- Escape every `|` inside a cell as `\|` (`postman-json` splits rows on unescaped `|`).
- Fenced code blocks do not work in table cells — always single-line inline backticks.
- Avoid a backtick inside a payload (it ends the inline code); use `$(id)` instead of `` `id` ``.
- `N/A` in every empty cell (never blank, `—` or `-`).
- Every row has exactly 14 cells.

---

## Priority guidance

- **P1**: Happy paths, required-field validation, 401/403 (missing/invalid token, denied role), BOLA, 404 on resource lookups, mass assignment / privilege escalation, injection on auth/login fields, unauthenticated destructive endpoints.
- **P2**: Optional-field validation, type/format/enum violations, boundary values at declared limits, expired/tampered tokens, side-effect verification, oversized payloads, malformed JSON.
- **P3**: Exploratory limits, exotic unicode, XSS/template injection in display text, rarely-used params.

---

## Worked example

Given this OpenAPI snippet:

```yaml
paths:
  /api/users:
    post:
      tags: [Users]
      summary: Create a new user
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:    { type: string, format: email }
                password: { type: string, minLength: 8, maxLength: 64, writeOnly: true }
                name:     { type: string, maxLength: 100 }
      responses:
        '201': { description: Created }
        '400': { description: Bad Request }
        '401': { description: Unauthorized }
```

The output looks like this (excerpt — a complete endpoint at Full depth would also have null/wrong-type rows per field, 403 and expired-token rows, more boundary rows and the per-endpoint Security MUSTs):

### Endpoint: `POST /api/users`

**Description**: Create a new user
**Auth required**: Yes (bearerAuth)
**Inputs**: `email` — string/email, required · `password` — string, required, 8–64, writeOnly · `name` — string, optional, max 100

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC_USERS_POST_001 | Users | /api/users | POST | Happy | P1 | `{{token}}` from TC_AUTH_POST_001 | Create user with required fields only; expect 201 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"jane+{{runId}}@hoctest.com","password":"SecurePass123!"}` | 201 | `user.id` (integer); `user.email`="jane+{{runId}}@hoctest.com"; `password` not present in response | Save `user.id` as `{{createdUserId}}` |
| TC_USERS_POST_002 | Users | /api/users | POST | Happy | P1 | `{{token}}` | Create user with all fields; expect 201 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"john@hoctest.com","password":"SecurePass123!","name":"John Smith"}` | 201 | `user.id` (integer); `user.name`="John Smith" | N/A |
| TC_USERS_POST_003 | Users | /api/users | POST | Validation | P1 | `{{token}}` | Create user without 'email'; expect 400 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"password":"SecurePass123!"}` | 400 | Error message indicates email is required | N/A |
| TC_USERS_POST_004 | Users | /api/users | POST | Validation | P2 | `{{token}}` | Create user with invalid email format; expect 400 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"not-an-email","password":"SecurePass123!"}` | 400 | Error message indicates email is invalid | N/A |
| TC_USERS_POST_005 | Users | /api/users | POST | Validation | P2 | `{{token}}` | Password of 65 characters (max 64); expect 400 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"jane2@hoctest.com","password":"<65 x 'a'>"}` | 400 | Error message indicates password is invalid | N/A |
| TC_USERS_POST_006 | Users | /api/users | POST | Auth | P1 | None | Create user without Authorization header; expect 401 | `Content-Type: application/json` | N/A | `{"email":"jane3@hoctest.com","password":"SecurePass123!"}` | 401 | [NEEDS REVIEW: spec doesn't define 401 schema] | Verify no side effect |
| TC_USERS_POST_007 | Users | /api/users | POST | Boundary | P2 | `{{token}}` | Password at exactly 8 characters; expect 201 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"min.pass@hoctest.com","password":"Pass123!"}` | 201 | `user.id` (integer) | N/A |
| TC_USERS_POST_008 | Users | /api/users | POST | Boundary | P3 | `{{token}}` | Name of 100 characters (declared max); expect 201 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"long.name@hoctest.com","password":"SecurePass123!","name":"<100 x 'a'>"}` | 201 | `user.id` (integer) | N/A |
| TC_USERS_POST_009 | Users | /api/users | POST | Security | P1 | `{{token}}` | Mass assignment: send read-only `id` and `role`; expect them ignored | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"mass@hoctest.com","password":"SecurePass123!","id":1,"role":"admin"}` | 201/400 | [NEEDS REVIEW: ignored (201) or rejected (400)?] If 201, returned id is not 1 and role is "user" | Once confirmed, set one status and add `` `user.role`="user" `` |
| TC_USERS_POST_010 | Users | /api/users | POST | Security | P2 | `{{token}}` | SQL injection in email is rejected; expect 400 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"' OR '1'='1","password":"SecurePass123!"}` | 400 | no SQL error leaked | N/A |
| TC_USERS_POST_011 | Users | /api/users | POST | Security | P2 | `{{token}}` | 1 MB string in name; expect 413 or 400, not 500 | `Authorization: Bearer {{token}}`<br>`Content-Type: application/json` | N/A | `{"email":"big@hoctest.com","password":"SecurePass123!","name":"<1048576 x 'a'>"}` | 400/413 | [NEEDS REVIEW: status 413 not declared in spec] | N/A |

Side-effect follow-up — it lives in the `GET /api/users/{id}` table, with that endpoint's own Method and counter:

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC_USERS_GET_004 | Users | /api/users/{id} | GET | Happy | P2 | User `{{createdUserId}}` created by TC_USERS_POST_001 | Created user is retrievable with the data sent; expect 200 | `Authorization: Bearer {{token}}` | `id={{createdUserId}}` | N/A | 200 | `user.email`="jane+{{runId}}@hoctest.com"; `user.id`="{{createdUserId}}" | [SIDE-EFFECT] Depends on TC_USERS_POST_001 |

---

## Notes on rendering

GitHub/GitLab/VS Code preview render this format. If the user prefers another grouping (e.g. one table per module), keep the 14-column schema and all conventions identical.
