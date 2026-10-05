---
name: postman-json
description: Convert reviewed API test cases (Markdown table format) into Postman Collection v2.1 JSON files with embedded pm.test() assertions, plus a matching environment.json file. Use this skill whenever the user has a reviewed test case file (typically produced by the api-test-design skill) and wants to import it into Postman, generate a Postman collection, create importable Postman JSON, build an executable test suite from test cases, or prepare collection for Newman/CI. Trigger on phrases like "convert to Postman", "generate Postman collection", "tạo file Postman", "xuất ra Postman JSON", "build collection from test cases", "make this runnable in Postman", or when the user uploads a Markdown test case file and asks for executable tests. Also trigger when user mentions Newman, Postman runner, or wants to automate the reviewed test cases.
metadata:
  author: tuyenvo224
  version: "1.0"
---

# Postman JSON Generator Skill

Convert reviewed API test cases (Markdown table) into a Postman Collection v2.1 JSON file plus a matching environment.json file, ready to import into Postman or run with Newman.

## When to use this skill

- User provides a Markdown test case file (from `api-test-design` skill or similar) and wants Postman output
- User asks to convert, export, or generate Postman collection from test cases
- User wants to run test cases via Newman in CI/CD

## Output deliverables

Always produce **two files**:

1. **`<yyyy-mm-dd_hh-mm-ss>-<name>-collection.json`** — Postman Collection v2.1 format
2. **`<yyyy-mm-dd_hh-mm-ss>-<name>-environment.json`** — Environment with variables (baseUrl, token, etc.)

The prefix is the **local time of the run** plus the slugified collection name (title from the input file, version removed), e.g. `2026-10-05_09-12-30-user-management-api-collection.json` / `2026-10-05_09-12-30-user-management-api-environment.json`. Every run writes a new pair, so earlier collections are never overwritten — including re-converting the same test case file.

By default both files are written next to the input file (same directory). Pass `--out-dir` when the user, or a calling workflow, specifies a different output location/filename — follow that instead of the default, and only write to that one location.

## Generation method — always use the provided script

**Do NOT hand-write the Postman JSON and do NOT write your own conversion script (Python, Node, or otherwise).** A ready-made, tested generator already exists at `scripts/generate-postman.js`. Always invoke it:

```
node .claude/skills/postman-json/scripts/generate-postman.js <input.md> [--out-dir <dir>] [--name "<Collection Name>"] [--base-url <url>] [--file-base <base-name>] [--flat] [--max-time <ms>] [--spec <file|url>] [--no-schema] [--strict-formats] [--dry-run]
```

- `--spec` — the OpenAPI 3.x / Swagger 2.0 spec (JSON or YAML, file path or URL) used for **response schema checks**. Defaults to the input's `**Source spec**:` line (relative paths resolve from the input file's folder). Every request then asserts that its JSON body matches the schema the spec declares for the status code actually returned. If the spec can't be loaded the script warns and skips schema checks — relay that, and ask for the spec location if the user wants them.
- `--no-schema` — turn schema checks off. `--strict-formats` — also check `format` (date-time, email, uri, uuid...); off by default because many APIs return e.g. `2026-10-04 09:54:12` for a `date-time` field — offer it when the user wants strict contract testing.
- `--max-time <ms>` — response-time limit for every request (default 2000; `0` = no time assertion). A row overrides it with `[MAX-TIME: <ms>]` in Notes; rows generating ≥ 100 000 characters (`<N x 'c'>`) get at least 10 000 ms.

- `--flat` — keep the file's row order (Module folder → requests) instead of Module > Endpoint > Test Type folders, and move each row noted `[ORDER: run after TC_xxx]` right after `TC_xxx`. **Pass it whenever the input contains `[ORDER:`** (check with a search before running) — the default folders regroup rows and would run e.g. "GET after DELETE" before the DELETE. Tell the user the collection is flat and why. Without `--flat` the script warns about `[ORDER:` rows.
- `--dry-run` — parse, validate and print the summary + warnings without writing files. Use it for the Step 2 summary.
- `--out-dir` — optional; defaults to the input file's own directory. Only pass it when the user, or a calling workflow, wants the output elsewhere.
- `--name` and `--base-url` are optional; the script auto-detects both from the input file's title and `**Base URL**:` line when omitted.
- `--file-base` — optional; replaces the timestamped prefix described in "Output deliverables". Pass `--file-base <exact-base-name>` only when the user or a calling workflow needs specific filenames — output becomes `<base-name>-collection.json` / `<base-name>-environment.json` verbatim (not slugified). Don't pass it just to avoid an overwrite: the default name is already unique per run.
- The script parses the Markdown, builds the folder hierarchy, generates `pm.test()` scripts, extracts variables, builds the environment file, validates, and writes both output files in one run — this covers Steps 3-6 below. Read its console output (parsed row count, modules, total requests, variables, auto-set vs. manual-fill variables, NEEDS REVIEW count, `[WARN]` lines) to report back to the user; do not re-derive this by hand.
- **Always relay every `[WARN]` line to the user.** Warnings cover: rows with the wrong column count (usually an unescaped `|` in a cell — the request for that row is wrong), duplicate TC_IDs, path params with no value (converted to `{{name}}`), missing Base URL, output files being overwritten, `[ORDER:` rows in folder mode, circular `[ORDER:` references, a spec that could not be loaded, rows whose endpoint is not in the spec, and multipart bodies that are not a JSON object. Also relay the `Files uploaded by multipart rows` line: those files must exist relative to the Newman working directory (or be re-selected in Postman). For column-count warnings, offer to fix the source Markdown (escape the pipe as `\|`) and re-run.
- If the script errors or produces wrong output for a given input format, fix `scripts/generate-postman.js` itself (or extend it) rather than working around it with a new one-off script — keep a single source of truth for the conversion logic.
- The steps below (and the reference files) describe the conversion rules the script implements — use them to understand/verify/extend its behavior, not as a manual alternative workflow.

## Core principles

1. **Faithful conversion** — Every test case row in the input becomes exactly one request in the collection. Do not merge, drop, or reorder without telling the user.
2. **Folder structure: Module > Endpoint > Test Type** — Three-level hierarchy (see "Folder structure" below).
3. **Auto-generated pm.test() scripts** — Each request gets test scripts asserting the expected status and response shape from the input.
4. **Variables, not hardcoded values** — `baseUrl`, `token`, dynamic IDs go to environment file, referenced as `{{varName}}` in the collection.
5. **Postman v2.1 schema compliance** — Output must validate against the official v2.1 schema so Postman imports cleanly.
6. **Preserve TC_IDs** — Each request name starts with the TC_ID from the source for traceability.

## Workflow

### Step 1: Read and parse the test case file

Read the Markdown file from the path the user provides.

Parse each table row into a structured object with these fields (matching the api-test-design output schema):

```
{
  tc_id, module, endpoint, method, test_type, priority,
  pre_condition, description, headers, params, body,
  expected_status, expected_response, notes
}
```

**Handling [NEEDS REVIEW] markers**: If a cell contains `[NEEDS REVIEW]`, generate the request with a placeholder and add a comment to the test script: `// TODO: [NEEDS REVIEW] — original note here`. Do not skip the row.

**Robust parsing tips**:
- Header rows may use any combination of pipes/whitespace — normalize first
- Cells are split on unescaped `|` only; `\|` inside a cell is a literal pipe. A row that doesn't split into exactly 14 cells is reported as a warning
- Cell content with `<br>` represents multi-line; split appropriately for headers
- Code in backticks (`` `{"key": "value"}` ``) should have backticks stripped before parsing as JSON
- Query and path values are percent-encoded (so `&`, `#`, `+`, `?`, spaces and non-ASCII in payloads reach the server as one value); `{{variables}}` and existing `%XX` escapes are kept as written, and path values keep `/`. A query line without `=` (`debug`) becomes a valueless flag (`?debug`)
- A long-string placeholder `<N x 'c'>` in a body, header or param (e.g. `<256 x 'a'>`, `<1048576 x 'a'>`) is replaced by `{{_repeat_<N>_<charcode>}}` and a pre-request script sets that variable to the character repeated N times; these `_repeat_*` variables are not added to the environment
- Multi-module files have `## Module: X` section headers — use these to set the module name

### Step 2: Plan the structure

For inputs with 20 or more test cases, first run the script with `--dry-run`, then show a short summary built from its output and wait for the user to confirm before running it again without `--dry-run`:

```
Will generate:
- Collection: "<API Title> Test Suite"
- Modules: 3 (Users, Orders, Products)
- Total endpoints: 11
- Total requests: 87
- Environment variables to extract: baseUrl, token, userId, orderId, productId
- Variables set automatically by earlier requests: userId, orderId
- Variables to fill manually before run: token, expired_token, other_user_token
- Rows with [NEEDS REVIEW]: 4
- Warnings: <list every [WARN] line>
```

For small inputs (<20 test cases), skip the summary and generate directly (still relay any warnings).

### Step 3: Build the collection structure

Follow the schema in `references/postman-schema.md`. Key structural rules:

**Folder hierarchy** (three levels):
```
Collection (root)
└── Module folder (e.g., "Users")
    └── Endpoint folder (e.g., "POST /api/users")
        └── Test Type folder (e.g., "Happy", "Validation", "Auth")
            └── Requests (TC_XXX_001, TC_XXX_002, ...)
```

**Request naming**: `<TC_ID> — <short description>`, e.g., `TC_USERS_POST_003 — Missing email returns 400`.

**Request body** — the mode follows the row's `Content-Type` header:

| Content-Type in Headers | Body cell | Postman body |
|---|---|---|
| `multipart/form-data` | JSON object; a value `"@file:<path>"` uploads that file; an array value sends the key once per item | `formdata` (the Content-Type header is dropped so Postman adds the boundary) |
| `application/x-www-form-urlencoded` | JSON object | `urlencoded` |
| `application/x-www-form-urlencoded` | `a=1&b=2` string | `raw`, sent as written |
| contains `xml` | XML text | `raw`, language xml |
| any other non-JSON type (`text/plain`, wrong-type tests) | anything | `raw`, sent as written |
| JSON or no Content-Type | JSON (malformed JSON is sent as written) | `raw`, language json |

**Auth on requests**: a collection-level `bearer` auth with `{{token}}` is added only when some row uses `Authorization: Bearer {{token}}`; those rows inherit it. Other credentials are set per request — see "Negative auth tests" below.

### Step 4: Generate pm.test() scripts

For every request, generate a test script in the `event` array with `listen: "test"`. Read `references/test-script-patterns.md` for the full pattern library.

**Minimum assertions per request**:
1. Status code matches `expected_status`
2. Response time below the limit (`--max-time`, default 2000 ms; `[MAX-TIME: <ms>]` per row)
3. If `expected_response` mentions specific fields with a type hint → assert those fields exist with correct types. The field name may be wrapped in backticks, single or double quotes: `` `id` (integer) ``, `'id' (integer)`, `"id" (integer)`. Paths may be dotted and indexed: `` `data.items[0].id` (integer) ``. Supported hints: integer (checked with `Number.isInteger`), number, string, JWT string, boolean, object, User object, array, null
4. For happy-path responses with IDs **or auth tokens** (`token`, `accessToken`, `refreshToken`, etc.) → save the value to an environment variable via `pm.environment.set(...)`, so downstream requests referencing `{{token}}`/`{{userId}}`/etc. keep working. This is not optional for a login/auth endpoint — without it, every other authenticated request in the collection fails on first run.
   - **Explicit `Save` directives (preferred)**: Notes or Expected Response may contain ``Save `data.token` as `{{token}}` and `data.user.id` as `{{adminId}}` `` (separator `as`, `→` or `->`). A path segment `list[?key=value]` picks the first array item whose `key` equals `value`, e.g. ``Save `reset.accounts[?role=user].email` → `{{userEmail}}` ``. Values are saved only when the response is 2xx.
   - **Heuristics (fallback)**: only when the file contains **no** `Save` directive at all. Token: a `Happy` login/auth row whose expected response mentions a token saves `json.data.token`/`json.token`. ID: a `Happy` row with method `POST`, a 2xx expected status and an expected response mentioning `id` saves `json.id` (or `json.data.id`, or `json.<resource>.id`) to `{{<singular-module>Id}}` (module `Users` → `userId`) — and only if some request actually references that variable.

5. Equality clauses (`` `user.email`="..." ``) — a value containing `{{variables}}` is resolved at run time with `pm.variables.replaceIn` and compared as a string.
6. Absence clauses (`` `password` not present in response ``) — a bare key must not appear at any depth of the JSON; a dotted path checks that exact path.
7. `Auth` rows also assert no sensitive **key** (`password`, `password_hash`, `hash`, `salt`, `secret`) appears in the JSON. Keys, not text: an error message such as "Invalid email or password" is fine.
8. Header clauses — `` header `Content-Type` contains "application/json" ``, `` header `Location` present ``, `` header `X-Powered-By` absent ``, `` header `Cache-Control` = "no-store" `` (names are case-insensitive).
9. **Schema check** (when a spec is available) — the response JSON must match the schema the spec declares for the status code actually returned, for each status the row allows. Rows with `[NO-SCHEMA]` in Notes, statuses without a JSON schema (204, 405 on undeclared methods) and endpoints not in the spec are skipped. OpenAPI specifics are converted for Ajv: `$ref` resolved (recursive refs stop), `nullable` → `type: [..., "null"]`, `writeOnly` properties removed from responses, `format` dropped unless `--strict-formats`.

**Per-run unique data**: when any cell contains `{{runId}}`, the collection gets a `runId` collection variable and the first request's pre-request script sets it to a new value (`Date.now().toString(36)`). Values like `jane+{{runId}}@hoctest.com` are therefore unique on every run, so the collection can be re-run without "already exists" failures. `runId` is not an environment variable and never needs manual fill.

The response body is parsed once with `let json = null; try { json = pm.response.json(); } catch (e) {}`, so a non-JSON body (204 No Content, gateway HTML error page) only fails the assertions that need it instead of aborting the whole script.

**Example for `TC_USERS_POST_001` (happy path, expected 201)**:
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response has user id", function () {
    const json = pm.response.json();
    pm.expect(json).to.have.property("id");
    pm.expect(json.id).to.be.a("number");
});

pm.test("Response time is under 2s", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});

// Save for chained tests
if (json && json.id) {
    pm.environment.set("userId", json.id);
}
```

### Step 5: Build the environment file

Extract all `{{variable}}` references from the collection. The environment file should include:

**Always include**:
- `baseUrl` — from the test case file metadata, or `https://api.example.com` placeholder marked `[NEEDS REVIEW]`
- `token` — empty value, marked secret type

**Dynamically include** (when referenced in test cases):
- `userId`, `orderId`, `productId`, etc. — IDs that happy-path tests will populate
- `expired_token`, `other_user_token` — auth test fixtures, filled by hand
- Any other `{{var}}` found in headers, URLs, or bodies (including `{{name}}` created for path params that had no value)

Postman environment entries have no note field, so "needs manual fill" is recorded in the **collection description**: the script lists every variable that no request sets via `pm.environment.set` (plus `baseUrl` when it's the placeholder) under `[NEEDS REVIEW] Fill these environment variables before running: ...`, and lists the auto-set ones separately. The same two lists are printed to the console as `Manual-fill variables` / `Auto-set variables`.

See `references/environment-template.md` for the exact format.

### Step 6: Validate and save

Before saving, run a sanity check (see `references/conversion-rules.md` for the full checklist):
- JSON is valid (parses without errors)
- Every request has a valid URL with `host` array properly split
- All `{{vars}}` in the collection are defined in the environment
- Required schema fields (`info.schema`, `info._postman_id`) are present

The script (run in Step 3-6 above) already writes both files next to the input file. Confirm the two written paths from its console output, relay any `[WARN]` lines, then end with instructions:

> "Two files are ready. To use them:
> 1. Open Postman → Import → drop both files
> 2. Select the environment in the top-right dropdown
> 3. Fill in the manual-fill variables: <list from `Manual-fill variables`>
> 4. Run the collection in order (Collection Runner) — <list from `Auto-set variables`> are set by earlier requests
> 5. (multipart rows only) re-select the upload files in Postman, or keep them next to the collection for Newman
>
> For Newman/CI: `newman run <collection>.json -e <environment>.json --env-var "token=<secret>" --working-dir <folder with upload files> --reporters cli,junit --reporter-junit-export results.xml`"

Mention `--working-dir` only when there are multipart rows, and the secret `--env-var` for each manual-fill credential.

## Important constraints

### Schema compliance

Output MUST validate as Postman Collection v2.1. The required fields are:
- `info.name`
- `info.schema` set to `"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"`
- `item` array (folders or requests)

Read `references/postman-schema.md` for the full schema definition.

### URL parsing

Postman v2.1 splits URLs into `raw`, `host` (array), `path` (array), and `query` (array) — see `references/postman-schema.md`. Do not just emit `{"url": "https://..."}` as a string; that's v2.0 syntax and may not parse correctly.

### Handling test data with variables

When the test case body contains `{{userId}}` or similar, keep it as-is in the request body string — Postman substitutes it at runtime. Do not try to resolve it during generation.

### Negative auth tests (401/403)

The script derives request auth from the input's `Authorization` header (any test type):

| Input header | Request auth | Header sent |
|---|---|---|
| (none) | `noauth` | none — the "missing token" 401 test |
| `Bearer {{token}}` | inherit collection auth | removed (collection adds it) |
| `Bearer <other value>` e.g. `invalid_xyz`, `{{expired_token}}`, `{{other_user_token}}` | request-level `bearer` with that value | removed (auth adds it) |
| `Basic <user>:<password>` (plain, may use `{{vars}}`) | request-level `basic` (Postman does the base64) | removed (auth adds it) |
| Anything else: empty value, `Bearer` with no token, base64 `Basic ...`, other schemes (`Token ...`, `Digest ...`) | `noauth` | kept exactly as written |

API keys in their own header (`X-API-Key: {{apiKey}}`) or in a query param (`api_key={{apiKey}}`), cookies (`Cookie: session={{sessionId}}`) and any custom auth header are ordinary headers/params: the request gets `noauth` and they are sent exactly as written — so "missing key" / "wrong key" / "key in the wrong place" rows send precisely what the test case says.

This guarantees the `Authorization` header is never sent twice and malformed-header tests send exactly what the test case specifies.

### Dependent test cases

Some test cases reference others (e.g., `Notes: Depends on TC_USERS_POST_001`). The folder structure preserves declaration order (by first appearance), and pm scripts saving IDs to environment make dependencies work at runtime. Rows that must run after a later endpoint's row are marked `[ORDER: run after TC_xxx]` — use `--flat` for those files (see "Generation method"); do not reorder requests by hand.

## What NOT to do

- Do not invent fields, headers, or assertions not in the input test cases
- Do not skip rows marked `[NEEDS REVIEW]` — generate them with TODO comments instead
- Do not use Collection v2.0 schema (deprecated)
- Do not put real tokens or secrets in the environment file — always leave `token` empty
- Do not generate Postman test scripts that depend on libraries Postman doesn't include (only built-in `pm.*`, `chai` assertions, and `lodash` are safe)
- Do not flatten the folder structure just because there's only one module — keep Module > Endpoint > Test Type unless the input has `[ORDER:` rows (then `--flat`) or the user asks for flat

## Reference files

- `references/postman-schema.md` — Postman Collection v2.1 schema, required fields, URL parsing rules
- `references/test-script-patterns.md` — Library of pm.test() patterns for each test type
- `references/environment-template.md` — Postman environment file format
- `references/conversion-rules.md` — Mapping rules from Markdown columns to Postman fields, validation checklist
- `scripts/generate-postman.js` — the generator to invoke; see "Generation method" above
- `scripts/lib/openapi.js` — spec loading (JSON/YAML, file/URL), operation lookup, OpenAPI → JSON Schema conversion

## Changing the generator

After any change to `scripts/` run the regression tests from the repo root and keep them green; add a fixture row + test for every new behavior:

```
node --test .claude/skills/postman-json/scripts/test/generate-postman.test.js
```

The structure tests need only Node. The end-to-end test runs `scripts/test/fixtures/cases.md` with Newman against `fixtures/mock-server.js` (skipped when Newman is not installed — `npm i -g newman`, or set `NEWMAN_PATH`). Rows marked `EXPECTED-FAIL: <test name>` in the fixture must fail exactly that assertion.