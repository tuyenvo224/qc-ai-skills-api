# API Test Cases — Shop API v1.2

**Source spec**: `spec.yaml`
**Generated**: 2026-10-04
**Base URL**: `http://localhost:4010/api/v1`
**Coverage depth**: Full
**Total test cases**: 16

Regression fixture for `generate-postman.js` (see `../generate-postman.test.js`). Rows whose Notes contain
`EXPECTED-FAIL: <test name>` are answered wrongly by `mock-server.js` on purpose: that test must fail.

## Module: Products

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC_PRODUCTS_GET_001 | Products | /products | GET | Happy | P1 | None | Search with characters that break URLs; expect 200 | N/A | `q=a&b #c+d e%2F`<br>`debug` | N/A | 200 | `items[0].id` (integer); `items[0].tag` (null); `echo.q`="a&b #c+d e/"; `echo.debug`=""; header `Content-Type` contains "application/json" | N/A |
| TC_PRODUCTS_GET_002 | Products | /products | GET | Happy | P2 | Product deleted by TC_PRODUCTS_DELETE_001 | List still works after delete; expect 200 | N/A | N/A | N/A | 200 | `items` is an array | [SIDE-EFFECT] [ORDER: run after TC_PRODUCTS_DELETE_001] |
| TC_PRODUCTS_POST_001 | Products | /products | POST | Happy | P1 | None | Upload a product image (multipart); expect 201 | `Content-Type: multipart/form-data`<br>`X-API-Key: {{apiKey}}` | N/A | `{"name":"Pen {{runId}}","image":"@file:fixtures/pixel.gif","tags":["a","b"]}` | 201 | `id` (integer); `fields.name`="Pen {{runId}}"; `fields.tags[1]`="b"; `file.filename`="pixel.gif"; `file.size`=43; `secret` not present in response; header `Location` present | Save `id` as `{{productId}}` |
| TC_PRODUCTS_POST_002 | Products | /products | POST | Happy | P2 | None | Response with a wrong id type is caught by the schema check | `Content-Type: multipart/form-data`<br>`X-API-Key: {{apiKey}}` | N/A | `{"name":"bad-schema"}` | 201 | `fields.name`="bad-schema" | EXPECTED-FAIL: Response body matches the spec schema for 201 |
| TC_PRODUCTS_POST_003 | Products | /products | POST | Security | P2 | None | 2000-char name is generated at run time; expect 201 | `Content-Type: multipart/form-data`<br>`X-API-Key: {{apiKey}}` | N/A | `{"name":"<2000 x 'z'>"}` | 201 | `id` (integer) | [MAX-TIME: 5000] |
| TC_PRODUCTS_PATCH_001 | Products | /products | PATCH | Validation | P2 | None | Undeclared method; expect 405 with Allow header | N/A | N/A | `{"name":"x"}` | 405 | header `Allow` present; header `Allow` contains "GET" | N/A |
| TC_PRODUCTS_DELETE_001 | Products | /products/{id} | DELETE | Happy | P1 | Product {{productId}} from TC_PRODUCTS_POST_001 | Delete the uploaded product; expect 204 | N/A | `id={{productId}}` | N/A | 204 | N/A | N/A |

## Module: Auth

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC_AUTH_POST_001 | Auth | /login | POST | Happy | P1 | None | Form login (object body); expect 200 | `Content-Type: application/x-www-form-urlencoded` | N/A | `{"user":"alice","pass":"right"}` | 200 | `form.user`="alice"; `form.pass`="right" | N/A |
| TC_AUTH_POST_002 | Auth | /login | POST | Happy | P2 | None | Form login (raw a=1&b=2 body); expect 200 | `Content-Type: application/x-www-form-urlencoded` | N/A | `user=bob&pass=right` | 200 | `form.user`="bob" | N/A |
| TC_AUTH_POST_003 | Auth | /login | POST | Auth | P1 | None | Wrong password; message mentions "password" but leaks nothing; expect 401 | `Content-Type: application/x-www-form-urlencoded` | N/A | `{"user":"alice","pass":"wrong"}` | 401 | Error message indicates user is invalid | N/A |
| TC_AUTH_GET_001 | Auth | /secure | GET | Happy | P1 | None | Basic auth written as user:password; expect 200 | `Authorization: Basic alice:s3cret` | N/A | N/A | 200 | `user` (string) | N/A |
| TC_AUTH_GET_002 | Auth | /secure | GET | Happy | P1 | None | API key header; expect 200 | `X-API-Key: {{apiKey}}` | N/A | N/A | 200 | `user` (string) | N/A |
| TC_AUTH_GET_003 | Auth | /secure | GET | Auth | P1 | None | Base64 Basic credentials sent verbatim; expect 401 | `Authorization: Basic Ym9iOndyb25n` | N/A | N/A | 401 | Error message indicates user is invalid | N/A |
| TC_AUTH_GET_004 | Auth | /secure | GET | Auth | P2 | None | Error body leaking a password key is caught | N/A | `leak=1` | N/A | 401 | N/A | EXPECTED-FAIL: No sensitive data leaked in error response |

## Module: Misc

| TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC_MISC_POST_001 | Misc | /xml | POST | Happy | P2 | None | XML body is sent raw; expect 200 | `Content-Type: application/xml` | N/A | `<a>1</a>` | 200 | `echo.body`="<a>1</a>"; `echo.contentType`="application/xml" | N/A |
| TC_MISC_GET_001 | Misc | /echo-path/{value} | GET | Boundary | P3 | None | Path value with space, # and ? is encoded; expect 200 | N/A | `value=a b#c?d` | N/A | 200 | `decoded.value`="a b#c?d" | N/A |
