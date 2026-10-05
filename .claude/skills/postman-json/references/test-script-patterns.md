# pm.test() Pattern Library

Reusable test script patterns for each test type. Use these as templates when generating the `event[].script.exec` array for each request.

## Universal assertions (every request gets these)

```javascript
pm.test("Status code is {{EXPECTED_STATUS}}", function () {
    pm.response.to.have.status({{EXPECTED_STATUS}});
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

Replace `{{EXPECTED_STATUS}}` with the actual expected status code from the test case.

---

## By test type

### 1. Happy path (2xx responses)

Standard pattern + response shape validation + save ID:

```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response is valid JSON", function () {
    pm.response.to.be.json;
});

pm.test("Response has required fields", function () {
    const json = pm.response.json();
    pm.expect(json).to.have.property("id");
    pm.expect(json).to.have.property("email");
});

pm.test("Field types are correct", function () {
    const json = pm.response.json();
    pm.expect(json.id).to.be.a("number");           // or "string" for UUIDs
    pm.expect(json.email).to.be.a("string");
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});

// Save resource ID for downstream tests
let json = null;
try { json = pm.response.json(); } catch (e) { json = null; }  // non-JSON body (204, HTML error) must not abort the script
if (json && json.id) {
    pm.environment.set("userId", json.id);
}
```

**Login / auth endpoints — always save the token.** If the Happy path response is from a login/auth endpoint and `expected_response` mentions a token field (e.g. `token`, `data.token`, `accessToken`), save it to the environment variable of the same name. Without this step every other request in the collection that relies on `{{token}}` will fail — this is not optional, even if the test case row doesn't say "save token" explicitly:

```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has data.token", function () {
    const json = pm.response.json();
    pm.expect(json).to.have.nested.property("data.token");
});

// Save token for use as {{token}} in all subsequent authenticated requests
let json = null;
try { json = pm.response.json(); } catch (e) { json = null; }  // non-JSON body (204, HTML error) must not abort the script
if (json && json.data && json.data.token) {
    pm.environment.set("token", json.data.token);
}
```

Match the environment variable name to whatever the rest of the collection actually references (e.g. if other requests use `{{userToken}}` for this role, save into `userToken` instead of `token`).

For collection (list) endpoints, also check array structure:
```javascript
pm.test("Response is an array", function () {
    const json = pm.response.json();
    pm.expect(json).to.be.an("array");
    // Or for paginated: pm.expect(json.data).to.be.an("array");
});
```

### 2. Validation (400)

```javascript
pm.test("Status code is 400", function () {
    pm.response.to.have.status(400);
});

pm.test("Error response is JSON", function () {
    pm.response.to.be.json;
});

pm.test("Error mentions the violated field", function () {
    const body = pm.response.text().toLowerCase();
    // Adjust the keyword to match the test case description
    pm.expect(body).to.include("email");
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

For specific constraint violations, add the relevant keyword check:
- Missing field → check for "required" or field name
- Format violation → check for "format" or "invalid"
- Length violation → check for "length" or "long"/"short"
- Range violation → check for "min"/"max"

### 3. Auth (401/403)

```javascript
pm.test("Status code is 401", function () {
    pm.response.to.have.status(401);
});

pm.test("Response indicates auth failure", function () {
    const body = pm.response.text().toLowerCase();
    pm.expect(body).to.satisfy(function (text) {
        return text.includes("unauthorized") ||
               text.includes("authentication") ||
               text.includes("token") ||
               text.includes("invalid");
    });
});

// Check JSON keys, not text: "Invalid email or password" is a normal message, a "password" key is a leak
pm.test("No sensitive data leaked in error response", function () {
    const leaked = [];
    (function walk(o) {
        if (o === null || typeof o !== "object") return;
        Object.keys(o).forEach(function (k) {
            if (/^(password|password_hash|passwordhash|hash|salt|secret)$/i.test(k)) leaked.push(k);
            walk(o[k]);
        });
    })(json);
    pm.expect(leaked, "sensitive keys in response").to.be.empty;
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

For 403:
```javascript
pm.test("Status code is 403", function () {
    pm.response.to.have.status(403);
});

pm.test("Response indicates permission denied", function () {
    const body = pm.response.text().toLowerCase();
    pm.expect(body).to.satisfy(function (text) {
        return text.includes("forbidden") ||
               text.includes("permission") ||
               text.includes("not allowed");
    });
});
```

### 4. Not Found (404)

```javascript
pm.test("Status code is 404", function () {
    pm.response.to.have.status(404);
});

pm.test("Response indicates resource not found", function () {
    const body = pm.response.text().toLowerCase();
    pm.expect(body).to.satisfy(function (text) {
        return text.includes("not found") ||
               text.includes("does not exist") ||
               text.includes("no such");
    });
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

### 5. Boundary cases

Boundary cases usually expect a 2xx (input at the edge is still valid). Use the Happy path template, with a comment noting what boundary is being tested:

```javascript
// Boundary test: password at exact min length (8 chars)

pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Server accepts boundary value", function () {
    pm.response.to.be.json;
});

pm.test("Response time is under 2000ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

For "just-over-boundary" cases that expect 400, use the Validation template instead.

### 6. Security

Security tests assert the API does NOT execute the payload and does NOT leak data:

```javascript
pm.test("Server does not return 500 (no crash)", function () {
    pm.expect(pm.response.code).to.not.equal(500);
});

pm.test("Response does not contain SQL error markers", function () {
    const body = pm.response.text().toLowerCase();
    pm.expect(body).to.not.include("sql");
    pm.expect(body).to.not.include("syntax error");
    pm.expect(body).to.not.include("mysql");
    pm.expect(body).to.not.include("postgres");
    pm.expect(body).to.not.include("sqlite");
});

pm.test("Response does not contain stack trace", function () {
    const body = pm.response.text();
    pm.expect(body).to.not.include("at line");
    pm.expect(body).to.not.include(".java:");
    pm.expect(body).to.not.include(".py:");
    pm.expect(body).to.not.include("Traceback");
});

pm.test("Response time is under 2000ms (no DoS)", function () {
    pm.expect(pm.response.responseTime).to.be.below(2000);
});
```

For XSS specifically, check the payload is escaped or stripped in the response:
```javascript
pm.test("XSS payload is escaped or stripped in response", function () {
    const body = pm.response.text();
    pm.expect(body).to.not.include("<script>alert(1)</script>");
});
```

---

## Pre-request script patterns (rarely needed)

If a test case requires setup data, use a pre-request script:

```javascript
// Generate a unique email for this run
pm.environment.set("dynamicEmail", "test+" + Date.now() + "@example.com");
```

Place this in the `event` array with `"listen": "prerequest"`.

---

## How to map test case fields to assertions

When generating the script, read these columns from the test case row:

| Test case column | Generates |
|---|---|
| `expected_status` | The `pm.response.to.have.status(N)` assertion |
| `expected_response` mentions "contains 'X'" | `pm.expect(json).to.have.property("X")` |
| `expected_response` mentions "X (integer)" | `pm.expect(json.X).to.be.a("number")` |
| `expected_response` mentions "X (string)" | `pm.expect(json.X).to.be.a("string")` |
| `notes` mentions "save id" or happy path | Add `pm.environment.set("...", json.id)` |
| Happy-path `expected_response` mentions a token field (`token`, `data.token`, `accessToken`, ...) — always, even without an explicit note | Add `pm.environment.set("token", json.data.token)` (or matching variable name) so downstream authenticated requests work |
| `[NEEDS REVIEW]` in expected_response | Emit assertions for status only; add `// TODO` comment |

---

## Output formatting rules

When putting the script into the JSON `exec` array:

1. Each line of code becomes one string in the array
2. Empty lines become `""`
3. Comments are fine — they help reviewers understand the assertions
4. No trailing semicolons missing — be strict

Example of correctly formatted `exec` array:

```json
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
  "// Save for chained tests",
  "let json = null;",
  "try { json = pm.response.json(); } catch (e) { json = null; }",
  "if (json && json.id) {",
  "    pm.environment.set('userId', json.id);",
  "}"
]
```

**Important**: Inside the JSON string, use single quotes for JavaScript strings to avoid escaping hell. Only escape double quotes when absolutely necessary (e.g., in `pm.test("...")` titles).
