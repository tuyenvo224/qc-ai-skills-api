---
name: api-test-design
description: Generate comprehensive API test cases in Markdown table format from OpenAPI/Swagger specifications. Use this skill whenever the user provides an OpenAPI spec (JSON/YAML), Swagger file, or any API definition file and asks to create test cases, test scenarios, QA documentation, or API testing artifacts. Trigger on phrases like "design test cases", "generate test cases from API", "create API tests", "test scenarios for endpoints", "sinh test case", "viết test case API", or whenever the user mentions API testing along with a spec file. Also trigger when the user wants to prepare test cases for review before converting to a Postman collection or other executable test format.
metadata:
  author: tuyenvo224
  version: "1.0"
---

# API Test Design Skill

Generate structured, **maximum-coverage** API test cases in Markdown table format from OpenAPI/Swagger specifications. The output is reviewed by a QA engineer and then converted by the `postman-json` skill into an executable Postman collection, so it must be both human-readable and machine-parseable.

## When to use this skill

- User provides an OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML, file or URL)
- User asks to generate, design, or write test cases for API endpoints
- User is preparing API test documentation for QA review
- User explicitly mentions wanting test cases as a Markdown table

## Core principles

1. **Faithful to the spec, exploratory where it is silent** — Never invent endpoints, fields, or response schemas. But a missing constraint is not a reason to skip a test: when the spec declares no limit/format/rule for an input, still generate the conventional exploratory case (e.g. 255/256-char strings, int32 max + 1) and mark it `[NEEDS REVIEW: <what the spec doesn't declare>]`. For status codes, see "Status codes not declared in the spec" below.
2. **Matrix-driven coverage** — Coverage comes from the mandatory matrices in `references/test-categories.md`, applied **per input field** and **per endpoint**, not from intuition. Every matrix item either becomes a row or is listed under "Not covered" with a reason. The matrices are a floor: add rows for any further risk you see.
3. **Realistic test data** — Plausible values (`jane@hoctest.com`, not `"string"`), the spec's own `example` values when present. See `references/test-data-library.md`.
4. **One intent per row** — Each row is one request testing one thing. `postman-json` maps one row to one Postman request.
5. **Machine-readable expectations** — Write Expected Response with the assertion clauses, and chain values with `Save ... as {{var}}` directives, exactly as defined in "Machine-readable conventions" in `references/output-template.md`. Anything written as free text produces no automated assertion.
6. **Traceable IDs** — `TC_<MODULE>_<METHOD>_<NNN>`, `<NNN>` is a running counter per `<MODULE>_<METHOD>` across the whole file (it does NOT restart per endpoint: `GET /users` gets `001..006`, `GET /users/{id}` continues at `007`).
7. **Parser-safe tables** — 14 cells per row, `|` inside a cell escaped as `\|`, `N/A` in empty cells, single-line JSON in inline backticks.

## Workflow

### Step 1: Parse the spec and build the field inventory

Read the spec (file or URL; OpenAPI 3.x or Swagger 2.0, JSON or YAML). Extract API metadata (title, version, servers), every endpoint (path + method), the **security schemes** (bearer/JWT, basic, API key in header/query/cookie, OAuth2 scopes) and roles, the methods each path declares, declared response headers, and tags (used as Module).

For every endpoint build the **field inventory** described in `references/test-categories.md` §0: each input's location (path, query, **header**, cookie, body), type/format, required/nullable, constraints, default, readOnly/writeOnly, **semantic role** (id, lookup key, display text, URL, email, secret, role, **file upload**...), and the **business rules** stated in descriptions. Resolve `$ref`, merge `allOf`, treat each `oneOf`/`anyOf` variant separately. Record each request content type (JSON, `multipart/form-data`, `application/x-www-form-urlencoded`, XML) — the rows must send that content type with its matching body syntax (`references/output-template.md` "Non-JSON bodies"). Note deprecated endpoints.

Pick the base URL: the non-localhost server if several are listed; say which one in the file header.

### Step 2: Plan coverage

Apply the matrices (including the HTTP-level cases in §5.4 — 405, 406, response headers, CORS/security headers), then the **de-duplication rules D1–D10** in `references/test-categories.md` §9 (shared mechanisms tested once in full, smoke elsewhere; repeated fields/ids/payload classes not repeated on every endpoint). Produce a coverage plan per endpoint — one line per category with the count and the concrete items — plus a list of what was collapsed and where it is covered:

```
Endpoint: POST /api/users   (inputs: name, email, password, role, avatar, hobbies)
- Happy (4): required only; all fields; role=admin; GET-after-create [SIDE-EFFECT]
- Validation (14): missing ×3 required; null ×3; wrong type ×6; email format; role enum; duplicate email; {}; [] body
- Auth (5): no header; invalid; malformed; expired; role=user → 403
- NotFound: N/A (no resource reference)
- Boundary (12): name ""/"   "/1/255*/256*/trim/unicode; email uppercase/plus; role "Admin"; optional null vs omitted; no body; text/plain  (* exploratory, no maxLength in spec)
- Security (8): mass assignment (id, is_active, created_at); SQLi email; XSS name; javascript: avatar; 1 MB hobbies; malformed JSON; password absent in response
Total: 43
Not covered: 409 (not declared → duplicate uses 400 [NEEDS REVIEW]); 429 (not declared)
```

- **Specs with more than 5 endpoints** — show the plan for every endpoint plus a grand total, then STOP and wait for the user to approve or adjust it. Do not generate test cases in the same turn.
- **Small specs (≤5 endpoints)** — skip showing the plan, but still build it internally and follow it.
- If the user asks for a **Lite/smoke** set, use the Lite depth in `references/test-categories.md` §10 and say so in the file header.

### Step 3: Generate test cases

Read `references/test-categories.md` (rules and matrices), `references/output-template.md` (file layout, columns, machine-readable conventions, worked example) and `references/test-data-library.md` (payloads). Generate one table per endpoint, grouped under `## Module: <name>`, with the 14 required columns in this order:

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |

Ordering: setup modules (database reset/seed, login) first; inside a module, endpoints in lifecycle order (create → read → update → delete), so that `postman-json`'s folder order runs dependencies first. A row that must run after a row of a later endpoint (GET after DELETE) gets `[ORDER: run after TC_xxx]` in Notes.

Chaining: every token/id/email a later row uses is produced by an earlier row with a `Save ... as {{var}}` directive, or listed as manual-fill in "Test data & pre-requisites". The primary token is `{{token}}`.

Re-runnable data: values under a uniqueness rule (email, username, slug, code) in rows that create data use `{{runId}}` (e.g. `jane+{{runId}}@hoctest.com`), so the suite can run again without "already exists" failures — see "Re-runnable data" in `references/output-template.md`.

For large specs, generate module by module, appending to the same file; keep the TC_ID counters continuous.

### Step 4: Self-check, save and present

Run the "Output quality checklist" below and fix every failure before saving. Then save following "Output" at the end of this file — **exactly one file**, all modules under `## Module: <name>` sections, never one file per module.

End by telling the user, in this order:
1. The file path and totals per Test Type.
2. The **blocking** `[NEEDS REVIEW]` items (credentials, sample-data values, ids other rows depend on) — these must be resolved before running, or dependent rows will fail.
3. "Review the test cases — mark any rows you want to change, add, or remove. When ready, I'll convert the approved set to a Postman collection."

## Test categories (must cover)

Full rules and mandatory matrices in `references/test-categories.md`.

1. **Happy** — required-only, all-fields, each behavior-changing enum value, each oneOf variant; response fields asserted with types; secrets absent.
2. **Validation (400)** — per field: missing, null, wrong type, format/pattern/enum, just-outside limits; per body: `{}`, wrong JSON type, duplicate-resource rule.
3. **Auth (401/403)** — for the spec's scheme(s) (bearer/JWT, basic, API key in header/query, cookie, OAuth2 scopes): missing/invalid/malformed/expired/tampered credential, credential in the wrong place, each denied role (403), BOLA on another user's resource, role matrix, revoked tokens (deleted user, after reset/password change).
4. **NotFound (404)** — non-existent and already-deleted ids, wherever the id lives (path, query **or body**); double delete.
5. **Boundary** — per field type matrix (strings, numbers, ids, enums, emails, dates, arrays, URLs, pagination, file uploads, header params), exploratory limits when undeclared, no body / wrong Content-Type; HTTP-level behavior (405 per path, 406, response headers — §5.4).
6. **Security** — injection chosen by semantic role (SQLi, NoSQLi, XSS, template, path traversal, command, CRLF, URL schemes/SSRF, malicious uploads, XXE for XML bodies), mass assignment, privilege escalation, data exposure, oversized payloads, malformed JSON, unauthenticated destructive endpoints (OWASP API Top 10 mapping in the reference).

Plus **business-rule rows** (§7: one positive + one negative per rule stated in descriptions) and **side-effect rows** (§8: GET after create/update, double delete, no side effect after 401/403, effects of special endpoints such as reset). They reuse the six Test Type values; Notes start with `[SIDE-EFFECT]`.

## Status codes not declared in the spec

Many specs only declare the success response. Categories 2–6 still apply. When a test needs a status code the spec does not declare for that endpoint:

- Use the conventional code: 400 validation, 401 missing/invalid token, 403 insufficient permission, 404 missing resource, 413 oversized payload, 415 unsupported Content-Type.
- When two outcomes are both acceptable, write both: `400/413`, `201/400` (e.g. mass assignment may be ignored or rejected).
- Mark `Expected Response` with `[NEEDS REVIEW: status <code> not declared in spec]`.
- Never invent other codes (e.g. do not guess `409`, `422`, `429`) unless the spec declares them — use `400` + `[NEEDS REVIEW]` instead, and list the alternative under "Not covered"/"Assumptions".

## Output quality checklist

Before saving, verify — and fix — each item:

**Coverage**
- [ ] Every endpoint has ≥1 Happy row; every behavior-changing enum value and oneOf variant has a Happy row
- [ ] Every required input has a "missing" row; each endpoint has ≥1 "null" row; every required/enum/id/number/boolean input has a "wrong type" row
- [ ] Every input with format/pattern/enum/min/max has a violation row
- [ ] Every string input has ≥1 Boundary row beyond empty string (whitespace / length / unicode); string inputs without a declared maxLength have exploratory 255/256 rows marked `[NEEDS REVIEW]`
- [ ] Every numeric/id input has 0 / negative / decimal / overflow rows (as applicable)
- [ ] Every string input has ≥1 injection row matching its semantic role; every URL field has a `javascript:` row
- [ ] Every POST/PUT/PATCH has mass-assignment and malformed-JSON rows; the full body-handling set (no body, `[]`, wrong Content-Type, oversized) exists once on the representative endpoint
- [ ] The full token-variant set (missing, invalid, malformed, wrong scheme, expired, tampered, alg:none) exists once on a representative endpoint; every other endpoint with auth has missing + invalid token rows, a 403 row per denied role, and (for resource ids) a BOLA row
- [ ] Every path has a 405 row for an undeclared method; the first Happy row of every endpoint asserts `` header `Content-Type` contains "application/json" `` (or the declared type); every declared response header (e.g. `Location` on 201) has a presence clause
- [ ] Every non-JSON operation sends its content type with the matching body syntax (multipart `@file:`, form object, XML); every upload file is listed under "Test data & pre-requisites"
- [ ] Credentials follow the spec's security scheme (output-template "Auth schemes"), with the scheme-specific negative rows (§3)
- [ ] De-duplication rules D1–D10 (`references/test-categories.md` §9) applied; every collapsed item is listed under "Not covered" as `covered by ...`; per-endpoint counts are inside the sanity range
- [ ] Every resource reference (path, query or body) has a non-existent-id row; every DELETE has a double-delete row
- [ ] Every business rule found in descriptions has positive and negative rows
- [ ] Every write endpoint has a side-effect row (GET after success) and one "no side effect after 401/403" row
- [ ] Destructive/administrative endpoints that are public are flagged with a Security row
- [ ] Every matrix item not generated is listed under "Not covered" with a reason

**Format & contract**
- [ ] TC_IDs unique across the file (counter per `<MODULE>_<METHOD>`)
- [ ] Every row has exactly 14 cells; every `|` inside a cell is `\|`; no blank cells (use `N/A`)
- [ ] Test Type is one of the six values; Priority is P1/P2/P3
- [ ] Every path `{placeholder}` has a value in Path/Query Params
- [ ] Expected Response uses the assertion clauses (backticked fields, `;`-separated); sensitive-field checks are absence clauses (`` `password` not present in response ``)
- [ ] Every create row with a unique field (email, username...) uses `{{runId}}` in that value
- [ ] Every follow-up that must run after a later endpoint's row has `[ORDER: run after TC_xxx]`
- [ ] Every `{{variable}}` used is either saved by an earlier row (`Save ... as {{var}}`) or listed as manual-fill
- [ ] Long strings use `<N x 'c'>`, never descriptions like `<65-char string>`
- [ ] Expected status codes match the spec, or are conventional codes marked `[NEEDS REVIEW: status <code> not declared in spec]`
- [ ] Header sections present: Summary (per Test Type), Test data & pre-requisites, Blocking items, Assumptions; footer: Coverage matrix, Not covered
- [ ] All modules are in a single output file

## What to do when the spec is incomplete

- **No error response schemas** — Generate the rows anyway; Expected Response `[NEEDS REVIEW: spec doesn't define error schema]` plus any clause you can still assert (e.g. `` `success`=false `` if success responses use that envelope).
- **No constraints on a field** — Generate exploratory boundary rows (principle 1).
- **No examples** — Synthesize realistic data from the test data library.
- **No auth scheme defined** — Ask the user once, then assume Bearer token if no answer.
- **Sample data / credentials unknown** — Use the most likely values from descriptions, mark `[NEEDS REVIEW]`, and list them under "Blocking items".
- **Vague descriptions** — Generate the obvious rows; put the open question in `Notes` with `[NEEDS REVIEW]`.
- **Non-JSON bodies (multipart, form-urlencoded, XML)** — Write the `Content-Type` header and the body syntax from `references/output-template.md` "Non-JSON bodies"; `postman-json` sends them natively. List upload files under "Test data & pre-requisites".
- **Auth scheme other than Bearer** — Use the credential syntax in `references/output-template.md` "Auth schemes"; list `{{apiKey}}` / `{{username}}` / `{{password}}` as manual-fill.
- **Spec location** — Write `**Source spec**:` as a path relative to the output file, or a URL; `postman-json` reads it for automatic response schema checks.

## What NOT to do

- Do not invent endpoints or fields not in the spec, and do not use non-conventional status codes the spec doesn't declare
- Do not skip a matrix item because the spec is silent — make it exploratory and mark it, or list it under "Not covered"
- Do not generate runtime/integration concerns the spec can't tell you about (race conditions, deadlocks, load testing) unless the user asks — list them under "Not covered"
- Do not write vague rows ("Test the endpoint works") or combine several intents in one row
- Do not use fixed values for unique fields in create rows — the second run fails with "already exists"
- Do not use real secrets or production credentials in the file
- Do not skip the coverage plan for specs with more than 5 endpoints

## Reference files

- `references/test-categories.md` — Field inventory, mandatory coverage matrices per category, OWASP API mapping, business rules, side-effect rows, coverage depth
- `references/output-template.md` — File layout, column conventions, machine-readable conventions (assertion clauses, `Save` directive, `<N x 'c'>`), priority guidance, worked example
- `references/test-data-library.md` — Realistic sample data, edge-case values, security payloads, auth/login test values

## Output

Default (when this skill is used standalone, not invoked from a workflow that specifies its own output path): create a new Markdown file in the `test-case-api/` directory at the **project root** (create the directory if it doesn't exist), named `yyyy-mm-dd_hh-mm-ss-feature-name.md`. `feature-name` is derived from the API title or spec filename, in lowercase kebab-case (e.g., `test-case-api/2026-10-03_14-30-00-user-service.md`). All modules go into this single file — do not create per-module files.

If a workflow or the user explicitly names a different output directory/filename for this step, follow that instead — do not write to both.
