# Test Categories — Detailed Rules

Read this file when planning and generating test cases. It expands the six categories listed in `SKILL.md` into **mandatory coverage matrices**. Treat every "MUST" item as a floor, not a ceiling: add more cases when the spec or business context suggests a real risk.

Each row of a matrix below becomes **one test case row** (one request, one intent). When an item does not apply to an endpoint/field, skip it and list the reason in the coverage plan and the "Not covered" section of the output — never drop it silently.

---

## 0. Before generating: build the field inventory

For every endpoint, list every **input** (path params, query params, request headers the spec declares, body fields — including nested fields and array items) and every **output** field of the success response. For each input record:

| Attribute | Where it comes from |
|---|---|
| Location | path / query / header / body |
| Type & format | `type`, `format` (email, uuid, date, date-time, uri, int32, int64...) |
| Required? Nullable? | `required`, `nullable` / `type: [x, "null"]` |
| Constraints | `minLength`/`maxLength`, `minimum`/`maximum`/`exclusive*`, `pattern`, `enum`, `minItems`/`maxItems`/`uniqueItems`, `multipleOf` |
| Default | `default` |
| Access | `readOnly` (server-set: `id`, `created_at`...), `writeOnly` (e.g. `password`) |
| Semantic role | identifier / lookup key / display text / URL / email / secret / free text / numeric amount / date / flag / role-or-permission |
| Business rules | from `description`/`summary` text (e.g. "email cannot be changed", "admin cannot delete themselves") |

The **semantic role** decides which Boundary and Security payloads apply (sections 5 and 6). The **business rules** become extra cases (section 7).

Resolve `$ref`, merge `allOf`, and for `oneOf`/`anyOf` treat each variant as its own happy path (use the `discriminator` value if present). Prefer the spec's own `example`/`examples` values for happy-path data; otherwise use `test-data-library.md`.

---

## 1. Happy path (`Happy`)

**MUST**:
- One case with **required fields only** → declared 2xx. Assert that defaults were applied (e.g. `role` defaults to `user`).
- One case with **all fields** (required + optional) → 2xx; assert optional fields are returned as sent.
- One case per **enum value** of any field that changes behavior (e.g. `role=user`, `role=admin`); plain descriptive enums only need one value.
- One case per **`oneOf`/`anyOf` variant** and per **content type** the endpoint accepts.
- Assert every required **response** field with a type hint (see the Expected Response syntax in `output-template.md`), and assert `writeOnly`/secret fields (e.g. `password`) are **absent** from the response.

**Per method**:
- **GET single** — existing resource → 200 with expected fields.
- **GET list** — no filters → 200 with array; one case per declared filter; one case with pagination (`page`/`limit`/`offset`/`cursor`) and one with sort if declared.
- **POST** — 201 (or the declared 2xx); save the created id for later rows (`Save ... as ...` directive).
- **PUT** — full replacement → 200/204.
- **PATCH** — partial body → 200/204.
- **DELETE** — existing resource → 200/204.

---

## 2. Validation (`Validation`, 400)

**MUST, per input field**:

| Case | Applies to |
|---|---|
| Missing (omit the field) | every required field (body, query, header) |
| `null` value | every required field; every non-nullable optional field |
| Wrong type (e.g. integer for string, string for integer, object/array for scalar) | every field — one case per field |
| Format violation | every field with `format` (email, uuid, date, date-time, uri, ipv4...) |
| Pattern violation | every field with `pattern` |
| Enum violation | every enum field (value outside the list) |
| Length / range violation | every field with min/max constraints (just below min, just above max — the "just outside" values belong here; the "exactly at the limit" values belong in Boundary) |
| Array constraint violation | `minItems`/`maxItems`/`uniqueItems`, wrong element type |
| Unknown extra field | when `additionalProperties: false` (otherwise see Mass assignment in Security) |

**MUST, per endpoint with a body**:
- Empty object `{}`.
- Body of the wrong JSON type (`[]` or `"text"` instead of an object).
- Duplicate-resource rule (e.g. email already registered) when the spec or description implies uniqueness. Use `409` only if the spec declares it; otherwise use `400` and mark `[NEEDS REVIEW: status for duplicate not declared]`.

**Per method**:
- **PATCH** — `null` for a non-nullable field; empty body (no-op or 400 per spec).
- **GET/DELETE** — wrong type for query/path params (`page=abc`, `id=abc`), missing required query params.

---

## 3. Authentication & Authorization (`Auth`, 401/403)

**MUST, per endpoint that requires auth** (token-variant rows are collapsed by rule D1 in §9 — full set on one representative endpoint, smoke elsewhere):

| Case | Expected |
|---|---|
| No `Authorization` header | 401 |
| Invalid token value (`Bearer invalid_token_xyz`) | 401 |
| Malformed header: `Bearer` with no token / wrong scheme (`Basic ...`) | 401 |
| Expired token (`{{expiredToken}}`, mark `[NEEDS REVIEW: provide expired token]`) | 401 |
| Tampered JWT signature (`{{tamperedToken}}`) — when tokens are JWT | 401 |
| Each role/scope that is **not** allowed (e.g. role=user on an admin endpoint) | 403 |
| BOLA/IDOR: authenticated user acts on **another user's** resource id | 403 or 404 per spec |

The table is written for Bearer tokens. For other `securitySchemes` use the equivalent credential (syntax in `output-template.md` "Auth schemes") and add the scheme-specific cases on the representative endpoint:

| Scheme | Extra cases (401 unless the spec says otherwise) |
|---|---|
| API key (header or query) | key missing · wrong key · key sent in the other location (query instead of header, or vice versa) · key of a revoked/other client `[NEEDS REVIEW]` |
| HTTP basic | wrong password · unknown user · malformed `Basic` value (not base64, no colon) · plain-text credentials over `http://` if the spec lists an http server `[NEEDS REVIEW]` |
| Cookie session | cookie missing · tampered value · cookie after logout (`[SIDE-EFFECT]`) · cookie of a deleted user |
| OAuth2 scopes | token without the required scope → 403, one row per scope the operation requires |
| Several schemes on one operation (`security: [A, B]`) | each alternative alone succeeds; none → 401 |

**SHOULD, at least once per API (put it on the most sensitive endpoint)**:
- `alg: none` JWT (`{{algNoneToken}}`) → 401.
- Token of a user that was deleted / deactivated → 401 (depends on a delete row; mark `[SIDE-EFFECT]`).
- Token issued before a password change / database reset / logout → 401 or documented behavior `[NEEDS REVIEW]`.
- Login endpoints: the error for "wrong email" and "wrong password" is identical (no user enumeration); password is case-sensitive; email case handling.

**Role matrix**: when the spec defines more than one role/scope, add one row per (role × endpoint) the role is **allowed** to call (Happy) and one per role it is **denied** (Auth 403).

For write methods (POST/PUT/PATCH/DELETE) add `Verify no side effect` to Notes, and add at least one follow-up row per write endpoint proving the unauthorized request changed nothing (see section 8).

**Skip only** when the endpoint is explicitly public in the spec (`security: []` or no security requirement and no global one). A public endpoint that **modifies or destroys data** (reset, seed, bulk delete) gets a Security row instead: "Destructive endpoint is callable without authentication" with `[NEEDS REVIEW: confirm this endpoint is intentionally public]`.

---

## 4. Not found (`NotFound`, 404)

**MUST** for every input that **references an existing resource**, wherever it is (path, query **or body** — e.g. `DELETE /users.php` with `{"id": 5}`):
- Well-formed but non-existent id (`99999999`, `00000000-0000-0000-0000-000000000000`).
- Id of a resource that was **deleted earlier in the run** (`[SIDE-EFFECT]`).
- For PUT/PATCH: non-existent id → 404 (never assume upsert unless the spec says so).
- For DELETE: delete the same id twice (second call → 404, or 204 if the spec declares idempotent delete — never 500).

**Not applicable**: endpoints with no resource reference (e.g. `POST /users` collection create, `GET /users` list without id).

---

## 5. Boundary & Edge cases (`Boundary`)

"Boundary" = values **at** or **around** a limit, and unusual-but-legal shapes. The "just outside" value goes to Validation when the spec declares the limit; when the spec declares **no** limit, test it here as an exploratory case.

### 5.1 Exploratory rule — spec without constraints

When a field has **no** declared limit, do NOT skip boundary testing. Generate exploratory cases with the conventional limits below, expected status = the most likely behavior, and mark `Expected Response` with `[NEEDS REVIEW: no <maxLength/maximum/...> declared in spec]`. Typical defaults: string 255 / 256 characters, plus one very long value (10 000 characters); integer int32 max / int32 max + 1.

### 5.2 Matrix by field type — MUST for every input field of that type

| Field type | Cases (one row each) |
|---|---|
| **String (any)** | empty `""` · whitespace only `"   "` · exactly `minLength` (or 1 char) · exactly `maxLength` (or 255 exploratory) · `maxLength + 1` when undeclared (256 exploratory) · leading/trailing whitespace (is it trimmed?) · unicode: Vietnamese diacritics + emoji · CJK / RTL text (one per API is enough) |
| **Optional field (any type)** | omitted vs explicit `null` vs empty value (`""`, `[]`) — check which one clears the stored value |
| **Email** | uppercase variant (case-insensitive match?) · plus-addressing `jane+test@...` · 254-char address |
| **Enum** | different case (`Admin` vs `admin`) · empty string |
| **Integer / number** | `0` · `-1` · exactly `minimum` · exactly `maximum` · decimal for an integer (`2.5`) · int32 max + 1 (`2147483648`) · numeric string (`"5"`) |
| **Identifier (id)** | `0` · negative · decimal · very large (int64) · array `[1,2]` (bulk-action abuse) · object |
| **Boolean** | string `"true"` · `1` / `0` |
| **Date / date-time** | invalid calendar date (`2025-02-30`) · leap day (`2024-02-29`) · wrong format (`15/03/2025`) · timezone offset · far past / far future |
| **Array** | empty `[]` · one item · duplicate items · many items (1000) · wrong element type |
| **URL** | valid https · `http://` · relative path · very long URL |
| **Pagination params** | `page=0` · `page=-1` · `limit=0` · `limit = max` · `limit = max + 1` · offset beyond total |
| **File (multipart upload)** | valid file of each accepted type · empty (0-byte) file · exactly the max size / max + 1 (exploratory 10 MB when undeclared) · disallowed type (`.exe`, `.svg` where only images are accepted) · extension/MIME mismatch (`.png` whose content is text) · double extension `photo.php.png` · file field missing · two files in a single-file field · unicode file name |
| **Header param** (declared `in: header`, e.g. `X-Request-Id`, `Accept-Language`) | missing (when required) · empty · wrong format · very long value (`<8192 x 'a'>`) |

### 5.3 Per endpoint with a body — MUST (collapsed by rule D1 in §9: full set on the main create endpoint)
- Body with only unknown fields (`{"foo":"bar"}`) when `additionalProperties` is not false.
- No body at all (request without `Content-Type` and body) → 400, not 500.
- Wrong `Content-Type` (`text/plain` with a JSON string) → `415` if declared, otherwise `400`/`415` marked `[NEEDS REVIEW]`.
- For endpoints that accept **several** content types (JSON + form, multipart + JSON): one Happy row per content type, and the JSON body sent as `multipart/form-data` (or vice versa) → 400/415.

### 5.4 HTTP-level behavior — per path / per API (collapsed by rule D10 in §9)

These cases come from HTTP itself, not from a field, so the spec rarely lists them. Use the conventional status, add `[NEEDS REVIEW: status <code> not declared in spec]` when undeclared, and put them in the table of the path they test (Test Type `Validation` unless stated).

| Case | Expected | Scope |
|---|---|---|
| Method not declared on the path (e.g. `PATCH` where only GET/POST exist) | `405` + `` header `Allow` present `` (some servers answer 404 — write `405/404`) | one row per path, picking a method the path does not declare |
| `Accept: application/xml` (or `text/html`) when the operation only produces JSON | `406`, or `200` with JSON — write `200/406` + `[NEEDS REVIEW]` | once per API |
| Response `Content-Type` | `` header `Content-Type` contains "application/json" `` on the **first Happy row of every endpoint** (a clause, not a new row) | every endpoint |
| `201 Created` | `` header `Location` present `` when the spec declares a `Location` header (clause on the create Happy row) | every create endpoint that declares it |
| Other response headers the spec declares (`X-RateLimit-*`, `ETag`, `Cache-Control`...) | one presence clause on a Happy row | per declared header |
| Conditional request (`If-None-Match: <etag>`) | `304` | only when the spec declares `ETag` |
| `HEAD` on a GET path | `200`, empty body | once per API, P3 |
| CORS preflight (`OPTIONS` with `Origin: https://evil.example` + `Access-Control-Request-Method: POST`) | no `Access-Control-Allow-Origin: *` on authenticated endpoints — `Security` row, `[NEEDS REVIEW: confirm CORS policy]` | once per API, P3 |
| Security headers | `` header `X-Powered-By` absent ``; `` header `X-Content-Type-Options` contains "nosniff" `` — `Security` row, `[NEEDS REVIEW]` | once per API, P3 |

Priority: boundary rows on required fields = P2; exotic ones (CJK/RTL, far-future dates) = P3; 405 rows = P2.

---

## 6. Security (`Security`)

Use payloads from `test-data-library.md`. Inject **one payload per row**, choose the payload by the field's **semantic role**:

| Semantic role of the field | MUST payloads (one row each) |
|---|---|
| Lookup key / filter / search / id-as-string / email used in login | SQL injection · NoSQL operator object (`{"$ne": null}`) in JSON bodies |
| Display text (name, title, bio, comment, hobbies) | XSS (`<script>…`) · SQL injection stored as literal (no error, round-trips unchanged) · template injection (`${7*7}`) |
| URL field (avatar, website, facebook, webhook, callback) | `javascript:alert(1)` scheme · SSRF target (`http://169.254.169.254/latest/meta-data/`, `http://localhost:22`) when the server may fetch the URL · `file:///etc/passwd` |
| File name / path parameter | path traversal (`../../../etc/passwd`) · command injection (`; cat /etc/passwd`) |
| File upload field | executable/script content with an image extension · SVG containing `<script>` · polyglot/oversized file (`[MAX-TIME: 10000]`) · zip bomb only if archives are accepted `[NEEDS REVIEW]` |
| XML body (endpoint accepts XML) | XXE entity (see `test-data-library.md`) · billion-laughs entity expansion |
| Header values the API reads | CRLF injection (`value%0d%0aX-Injected: 1`) |

When several fields share a role, apply de-duplication rule D4 (§9): one field per endpoint, rotating.

**MUST, per endpoint**:

| OWASP API Top 10 (2023) | Case | Applies to |
|---|---|---|
| API3 — Mass assignment | Send server-controlled fields (`id`, `role`, `is_active`, `created_at`, `password_hash`, `balance`...) in the body; expect them ignored or rejected | every POST/PUT/PATCH |
| API5 — Privilege escalation | Non-admin tries to set `role=admin` / change protected fields of their own record | every endpoint that edits a user/permission-bearing resource |
| API3 — Excessive data exposure | Response does not contain `password`, hashes, tokens of other users, internal fields | every endpoint returning a user/account object (combine with a Happy row's Expected Response if cleaner) |
| API4 — Resource consumption | Oversized body / one field of 1 MB (`<1048576 x 'a'>`) → 413 or 400, not 500/timeout | at most two endpoints (rule D7, §9) |
| API4 — Resource consumption | `limit` far above maximum (`limit=100000`) → capped or 400 | every list endpoint with paging |
| — | Malformed JSON (one variant per endpoint; vary the variant across endpoints) → 400 | every endpoint with a body |
| API8 — Misconfiguration | Error responses do not leak stack traces / SQL errors (put `no SQL error leaked` in Expected Response of the SQLi rows) | covered by injection rows |

**MUST, per API (once)**:
- API5 — Every public endpoint that is destructive or administrative (reset, seed, export, bulk delete) is flagged with a "callable without authentication" row.
- API1 — At least one BOLA row per resource type (see section 3).
- API2 — Login brute force / rate limiting: one row expecting `429` **only if** the spec declares 429; otherwise list it under "Not covered" with the reason.

Default expected status for injection into a **format-validated** field (email, uuid, integer id) = `400`; into **free text** = `2xx` with the payload stored literally (assert the round-tripped value with `field.path="..."`). Mark XSS rows `[NEEDS REVIEW: confirm escaping policy]` unless the spec states one.

Priority: injection/mass-assignment/privilege-escalation/BOLA on write or auth endpoints = P1–P2; the rest = P3.

---

## 7. Business rules from descriptions

Read every `summary`/`description` (endpoint, parameter, schema, property). Each stated rule gets **at least one positive and one negative row**, Test Type by result (`Happy` / `Validation` / `Auth` / `NotFound`). Examples:
- "Email cannot be changed" → PUT with a new email → 200 and email unchanged (`profile.email="<original>"`).
- "Admin cannot delete themselves" → DELETE own id → 400/403.
- "Reset restores sample data" → after creating a user, reset, then the user is gone.

If a rule is ambiguous, still write the row and put the question in `Notes` with `[NEEDS REVIEW]`.

---

## 8. Side-effect verification rows (behavior, not just status code)

| Method / situation | What to verify | How |
|---|---|---|
| **POST** create | Resource is retrievable and stored as sent | Follow-up GET by the saved id; assert sent fields |
| **POST** non-idempotent | Repeating the request → second resource, or duplicate rejected per uniqueness rule | Repeat the POST |
| **PUT** replace | Idempotent; omitted optional fields are cleared | Call twice; then PUT without optional fields and GET |
| **PATCH** | Only submitted fields change | GET after PATCH; assert untouched fields |
| **DELETE** | Resource is gone; second delete → 404; deleted user's token rejected | GET → 404; DELETE again → 404 |
| **401/403 on a write** | Nothing was created/changed/deleted | Follow-up GET (at least one per write endpoint) |
| **Special endpoints** (reset, seed, logout, bulk, import) | The effect really happened; calling twice is safe; existing tokens/data behave as documented | GET/login after the call; call twice |
| **GET list** | Filters/pagination/sort actually narrow/order results | Compare counts/order |

**How to record them**: each verification is its own row. Test Type = the type matching that row's own expected result (`Happy` for a successful follow-up GET, `NotFound` for a 404 follow-up, `Auth` for a rejected token). Start `Notes` with `[SIDE-EFFECT]`, name the setup row, and put the dependency in `Pre-condition` too, e.g. `[SIDE-EFFECT] Depends on TC_USERS_POST_001 — uses {{createdUserId}}`.

**Execution order**: order endpoints inside each module along the resource lifecycle (create → read → update → delete) and put setup modules (reset, login) first, so dependencies run before the rows that need them. When a follow-up must run after a row of a **later** endpoint (e.g. GET after DELETE — the row lives in the GET table, which comes before DELETE), add `[ORDER: run after TC_xxx]` to Notes. `postman-json --flat` moves such rows right after `TC_xxx`; its default Module → Endpoint → Test Type folders do not, and it warns about them.

---

## 9. De-duplication rules (apply after building the matrices, before writing the plan)

The matrices are applied per field and per endpoint, which produces many rows that exercise the **same code path**. Collapse them with the rules below. A collapsed item is not dropped: list it under "Not covered" as `covered by <TC_ID / endpoint>`.

| # | Situation | Rule |
|---|---|---|
| D1 | **Shared mechanisms** — token verification, JSON parsing, body-size limit, Content-Type handling | Test the full variant set **once**, on one representative endpoint (prefer a simple authenticated GET for token variants, the main create endpoint for body handling). Every other endpoint keeps a smoke subset: auth → no header + invalid token (+ 403 per denied role + side-effect row); body → `{}` + one malformed-JSON variant. Keep the per-endpoint smoke because each handler/file may check auth or parse the body on its own. |
| D2 | **Same field on several endpoints** (e.g. `name` on create user, update user, update profile) | Full boundary matrix on the **first** endpoint where the field appears; later endpoints keep only: empty, whitespace-only, over-limit (or exploratory 256), unicode. One CJK/RTL row per API. |
| D3 | **Same identifier semantics on several endpoints** (e.g. `id` in PUT and DELETE bodies) | Split the id boundary set between the endpoints (≈4 each) instead of repeating all of them; keep bulk-abuse (`[1,2]`) and overflow once each. |
| D4 | **Same payload class for several fields of the same semantic role** (XSS for name and hobbies, `javascript:` for facebook and avatar) | One field per endpoint, rotating the field across endpoints so every field is hit once somewhere. |
| D5 | **`null` vs missing** for required fields | One `null` row per endpoint (on the most important required field); "missing" stays per field. |
| D6 | **Wrong type for optional free-text fields** | Skip by default (P3); keep wrong type for required fields, enums, ids, numbers and booleans. |
| D7 | **Server-level limits** (oversized payload) | At most two endpoints (login/auth + main create). |
| D8 | **Payloads irrelevant to the backend** (NoSQL operators against an SQL backend, XXE without XML) | Keep one type-confusion row (e.g. operator object in a login password); skip the rest. |
| D9 | **Low-information happy variants** (repeat-identical-PUT, revert-a-change rows) | Keep only when the spec states idempotency or the revert is needed to keep later rows valid. |
| D10 | **HTTP-level behavior** (§5.4) | 405: one row per **path** (not per method). 406, HEAD, CORS, security headers: once per API. Response-header checks are clauses on existing Happy rows, never new rows. File-upload matrix (§5.2): full set on the first upload field, then valid + disallowed type + oversize on the others. |

Never collapse: mass assignment and privilege escalation per write endpoint, business-rule rows, BOLA per resource type, side-effect rows, required-field "missing" rows, 403 per denied role per endpoint.

Sanity range at Full depth after de-duplication: ~12–25 rows per write endpoint, ~5–10 per read endpoint, ~20–30 for a login endpoint. Clearly more means a rule above was not applied; clearly fewer means a matrix item was skipped.

---

## 10. Coverage depth

- **Full (default)** — everything above.
- **Lite** (only when the user asks for "smoke"/"lite"/"quick" or names P1 only) — Happy + required-field Validation + one 401 per endpoint + 404 + the per-endpoint Security MUSTs on write endpoints. State in the file header that the depth is Lite.

For row-count expectations see the sanity range in §9.
