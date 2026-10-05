# Test Data Library

Reusable, realistic sample data and security payloads. Use these instead of placeholder strings like `"string"` or `"123"`.

---

## Realistic sample values by type

### Strings

| Field type | Realistic samples |
|---|---|
| Name (person) | `Jane Doe`, `John Smith`, `Nguyễn Văn An`, `María García` |
| Email | `jane@hoctest.com`, `john.doe+test@company.io`, `user123@test.org` |
| Phone | `+1-555-0123`, `+84-901-234-567`, `+44 20 7946 0958` |
| URL | `https://hoctest.com/page`, `https://api.hoctest.io/v1/` |
| Username | `jane_doe`, `johnsmith2024`, `dev.user` |
| Password (valid) | `SecurePass123!`, `MyP@ssw0rd2024`, `Test1234!@#$` |
| Address | `123 Main St, Springfield, IL 62701, USA` |
| City | `Hanoi`, `San Francisco`, `Tokyo`, `London` |
| Country code | `VN`, `US`, `GB`, `JP` (ISO 3166-1 alpha-2) |
| Language code | `en-US`, `vi-VN`, `ja-JP` (BCP 47) |
| Currency | `USD`, `VND`, `EUR`, `JPY` (ISO 4217) |
| UUID | `550e8400-e29b-41d4-a716-446655440000` |
| Hex color | `#FF5733`, `#3B82F6` |
| Slug | `getting-started`, `api-test-design` |

### Numbers

| Field type | Realistic samples |
|---|---|
| Age | `25`, `42`, `67` |
| Price (USD cents) | `999`, `4999`, `99999` |
| Quantity | `1`, `5`, `100` |
| Rating (1-5) | `4`, `5`, `3` |
| Latitude | `21.0285` (Hanoi), `37.7749` (SF) |
| Longitude | `105.8542` (Hanoi), `-122.4194` (SF) |
| Percentage | `0.15`, `0.75`, `1.0` |

### Dates & times

| Field type | Realistic samples |
|---|---|
| ISO 8601 date | `2025-03-15` |
| ISO 8601 datetime UTC | `2025-03-15T10:30:00Z` |
| ISO 8601 with timezone | `2025-03-15T10:30:00+07:00` |
| Unix timestamp (s) | `1742036400` |
| Unix timestamp (ms) | `1742036400000` |
| Date of birth | `1990-05-20` (adult), `2015-08-10` (minor for age tests) |

### IDs

| Field type | Realistic samples | Use for |
|---|---|---|
| Integer ID (valid) | `1`, `42`, `12345` | Happy path |
| Integer ID (non-existent) | `99999999`, `999999999999` | 404 tests |
| Integer ID (malformed) | `abc`, `1.5`, `-1` | 400 tests |
| UUID (valid existing) | `550e8400-e29b-41d4-a716-446655440000` | Happy path |
| UUID (non-existent) | `00000000-0000-0000-0000-000000000000` | 404 tests |
| UUID (malformed) | `not-a-uuid`, `550e8400-e29b-41d4-a716` | 400 tests |

---

## Edge case payloads

### String boundary values

```
""                                    # empty string
" "                                   # single space
"   leading whitespace"               # whitespace handling
"trailing whitespace   "
"a"                                   # single char (min length)
"<255 x 'a'>"                         # max length 255 — placeholder syntax, see output-template.md
"<256 x 'a'>"                         # one over max
"<10000 x 'a'>"                       # very long, exploratory when no maxLength is declared
```

In table cells always write long strings with the `<N x 'c'>` placeholder (never a description like `<65-char string>`).

### Wrong JSON shapes (Validation / Boundary)

```
{}                                    # empty object
[]                                    # array instead of object
"text"                                # string instead of object
null                                  # JSON null body
{"name": ["Jane"]}                    # array where a scalar is expected
{"name": {"first": "Jane"}}           # object where a scalar is expected
{"id": [1, 2, 3]}                     # array of ids — bulk-action abuse
{"age": "25"}                         # numeric string for an integer
{"is_active": "true"}                 # string for a boolean
```

### Date & email edge cases

```
2025-02-30                            # invalid calendar date
2024-02-29                            # leap day (valid)
15/03/2025                            # wrong format
2025-03-15T10:30:00+14:00             # extreme timezone offset
1900-01-01 / 2999-12-31               # far past / far future
JANE@HOCTEST.COM                      # uppercase email
jane+qa@hoctest.com                   # plus-addressing
<64 x 'a'>@<185 x 'b'>.com            # ~254-char email (max length per RFC 5321)
```

### Unicode & special characters

```
"Nguyễn Văn 😀"                       # Vietnamese diacritics + emoji
"日本語テスト"                          # CJK characters
"العربية"                             # RTL Arabic
"O'Brien-Smith & Co."                # Apostrophe, ampersand
"Line1\nLine2\tTabbed"               # Control characters
"<>&\"'"                              # HTML-significant chars
"NULL"                                # String literal "NULL"
"undefined"                           # String literal "undefined"
"\u0000"                              # Null byte
```

### Number edge cases

```
0
-1
1
2147483647       # int32 max
2147483648       # int32 max + 1
9223372036854775807  # int64 max
0.1 + 0.2        # floating-point precision (0.30000000000000004)
NaN
Infinity
-Infinity
```

---

## Security payloads

### SQL Injection

```sql
' OR '1'='1
' OR '1'='1' --
admin' --
'; DROP TABLE users; --
' UNION SELECT NULL,NULL,NULL --
1' OR '1'='1
1; SELECT * FROM users WHERE 't'='t
```

**Where to inject**: Any string field, especially `email`, `username`, `search`, `filter`, `id` (when expressed as string).

**Expected behavior**: API treats input as literal string (no SQL execution). Response is either 400 (rejected as invalid format) or 200 with no rows (no match for literal string).

### XSS (Cross-Site Scripting)

```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
"><img src=x onerror=alert(1)>
javascript:alert(1)
<svg onload=alert(1)>
<iframe src="javascript:alert(1)"></iframe>
${7*7}                  # template injection (expression languages)
<%= 7*7 %>              # template injection (ERB/EJS)
```

Do **not** use the `{{7*7}}` template payload: `{{...}}` is Postman variable syntax and would be mangled. Use `${7*7}` or `<%= 7*7 %>`.

**Where to inject**: Any string field that might be reflected in HTML response (names, comments, descriptions, titles).

**Expected behavior**: Input stored as-is OR HTML-escaped on output. Test should verify the response is not interpreted as HTML by clients.

### Command Injection

```
; ls -la
; cat /etc/passwd
&& whoami
`id`
$(whoami)
```

**Where to inject**: Fields likely to be passed to shell commands (filenames, paths, processing options).

**Table-safety note**: a pipe-based payload such as `| cat /etc/passwd` is valid too, but inside a table cell it must be written as `\| cat /etc/passwd` — a bare `|` breaks the Markdown table and the `postman-json` parser. The backtick payload `` `id` `` also clashes with inline-code backticks in a cell; prefer `$(id)` in table rows.

### Path Traversal

```
../../../etc/passwd
..\..\..\windows\system32\config\sam
%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd     # URL-encoded
....//....//....//etc/passwd                # bypass attempts
```

**Where to inject**: Path/file params, download endpoints.

### NoSQL Injection (MongoDB)

```json
{"$ne": null}
{"$gt": ""}
{"$where": "this.password == this.username"}
```

**Where to inject**: Authentication endpoints accepting JSON.

### XXE (XML External Entity)

Only relevant if API accepts XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<foo>&xxe;</foo>
```

### Oversized payload

- Body size: 10 MB JSON file (e.g., array with 1 million simple objects)
- Single string field: 1 MB of `"a"` repeated
- Deeply nested JSON: 1000 levels of `{"a":{"a":{"a":...}}}`

**Expected behavior**: 413 Payload Too Large, or 400 with size limit message. Should NOT cause server timeout or 500.

### Malformed JSON

```
{"name": "test"                       # missing closing brace
{"name": "test",}                     # trailing comma (invalid in strict JSON)
{name: "test"}                        # unquoted key
{"name": 'test'}                      # single quotes
{"name": "test" "email": "x@y.z"}    # missing comma
```

**Expected behavior**: 400 with JSON parse error message. Use a different variant per endpoint.

### URL-field payloads (scheme abuse / SSRF)

```
javascript:alert(1)                          # executes when rendered as a link
data:text/html,<script>alert(1)</script>     # data URI
file:///etc/passwd                           # local file scheme
http://169.254.169.254/latest/meta-data/     # cloud metadata (SSRF)
http://localhost:22                          # internal port probe (SSRF)
http://127.0.0.1:8080/admin                  # internal admin (SSRF)
```

**Where to inject**: avatar, website, facebook, webhook, callback, image-URL fields. SSRF rows only matter when the server fetches the URL — otherwise keep only the scheme rows.

**Expected behavior**: 400 (scheme not allowed) or stored but never fetched/rendered — mark `[NEEDS REVIEW]` when the spec gives no URL policy.

### CRLF / header injection

```
value%0d%0aX-Injected: 1
value\r\nSet-Cookie: hacked=1
```

**Where to inject**: values the API copies into response headers (redirect URLs, file names in `Content-Disposition`, custom headers).

### Mass assignment fields

Add these to POST/PUT/PATCH bodies when they are **not** client-writable (readOnly in spec, or obviously server-controlled):

```
"id": 1
"role": "admin"
"is_admin": true
"is_active": false
"created_at": "2000-01-01T00:00:00Z"
"updated_at": "2000-01-01T00:00:00Z"
"password_hash": "x"
"email_verified": true
"balance": 999999
"owner_id": 1
```

**Expected behavior**: fields ignored (response/stored values unchanged) or 400. Assert the protected values did **not** change (e.g. `user.role`="user").

### Sensitive data that must never appear in responses

`password`, `password_hash`, `hash`, `salt`, `secret`, `api_key`, `refresh_token` of other users, internal ids/flags not in the response schema. Write the check as an absence clause in Expected Response (`` `password` not present in response ``) — `postman-json` asserts the key appears nowhere in the JSON.

---

## Authentication test values

| Scenario | Header value | Variable to document |
|---|---|---|
| Missing | (omit Authorization header entirely) | — |
| Empty | `Authorization: ` | — |
| Wrong scheme | `Authorization: Basic dXNlcjpwYXNz` (when Bearer expected) | — |
| Malformed Bearer | `Authorization: Bearer` (no token after) | — |
| Invalid token | `Authorization: Bearer invalid_token_xyz` | — |
| Expired token | `Authorization: Bearer {{expiredToken}}` — mark `[NEEDS REVIEW: provide expired token]` | manual-fill |
| Tampered JWT (payload changed, old signature) | `Authorization: Bearer {{tamperedToken}}` | manual-fill |
| `alg: none` JWT | `Authorization: Bearer {{algNoneToken}}` | manual-fill |
| Lower-privilege role (403) | `Authorization: Bearer {{userToken}}` | saved by the user-login row |
| Another user of the same role (BOLA) | `Authorization: Bearer {{otherUserToken}}` | saved by a second login row |
| Deleted / deactivated user | `Authorization: Bearer {{deletedUserToken}}` | saved before the delete row (`[SIDE-EFFECT]`) |

Variable names are camelCase. The primary admin/default token is `{{token}}` (collection-level auth in Postman).

### Other auth schemes

| Scheme | Valid | Negative values |
|---|---|---|
| API key header (name from spec, e.g. `X-API-Key`) | `X-API-Key: {{apiKey}}` | header omitted · `X-API-Key: invalid_key_xyz` · `X-API-Key: ` (empty) · key moved to query `api_key={{apiKey}}` |
| API key query (e.g. `api_key`) | `api_key={{apiKey}}` | param omitted · `api_key=invalid_key_xyz` · key moved to header |
| HTTP basic | `Authorization: Basic {{username}}:{{password}}` | `Basic {{username}}:WrongPass123!` · `Basic nobody:x` · `Basic not-base64!!` · `Basic dXNlcg==` (base64 of `user`, no colon) |
| Cookie | `Cookie: session={{sessionId}}` (saved by the login row: ``Save `...` as `{{sessionId}}` `` when the id is in the body; otherwise manual-fill) | cookie omitted · `session=tampered123` · `{{loggedOutSessionId}}` |

`{{apiKey}}`, `{{username}}`, `{{password}}` are manual-fill unless a row saves them; list them under "Test data & pre-requisites".

### Login-specific values

| Scenario | Example |
|---|---|
| Wrong password, existing email | real email + `WrongPass123!` |
| Unknown email | `nobody@hoctest.com` + valid-looking password — error text must match the wrong-password case (no user enumeration) |
| Password case changed | `securepass123!` instead of `SecurePass123!` → 401 |
| Email with surrounding spaces | `"  admin@hoctest.com  "` |

---

## Upload test files

Keep them in `test-files/` next to the test case file and reference them as `"@file:test-files/<name>"` in multipart bodies. List the ones a run needs under "Test data & pre-requisites" with how to create them.

| File | Purpose | How to create |
|---|---|---|
| `avatar.png` (small valid PNG) | Happy upload | any real PNG < 100 KB |
| `photo.jpg` | second accepted type | any real JPEG |
| `empty.png` | 0-byte file | create an empty file |
| `large.png` | max size + 1 (or 10 MB exploratory) | `fsutil file createnew large.png 10485761` (Windows) / `truncate -s 10485761 large.png` |
| `fake.png` | MIME mismatch: text content, image extension | a text file renamed to `.png` |
| `script.svg` | SVG with `<svg onload=alert(1)>` | text file with that content |
| `photo.php.png` | double extension | copy of `avatar.png` renamed |
| `program.exe` | disallowed type | any small binary renamed |
| `ảnh đại diện.png` | unicode file name | copy of `avatar.png` renamed |

Postman sends the file's own name, so file-name tests need a file with that name on disk.

---

## When to use which data

- **Happy path** → realistic samples, top of each section (or the spec's own `example` values)
- **Validation tests** → malformed versions matching the field's constraint, wrong JSON shapes
- **Boundary tests** → edge case payloads, date & email edge cases
- **Security tests** → security payloads chosen by the field's semantic role (see `test-categories.md` §6), mass assignment fields, URL-field payloads
- **404 tests** → "non-existent" samples from the IDs section
- **Auth tests** → values from "Authentication test values" and "Login-specific values"