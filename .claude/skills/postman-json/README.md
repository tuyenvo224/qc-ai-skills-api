# postman-json

Skill chuyển file **test case API dạng bảng Markdown** (đã review) thành **Postman Collection v2.1** có sẵn
`pm.test()` assertion, kèm 1 file **environment**. Hai file này import thẳng vào Postman hoặc chạy bằng Newman.
File này hướng dẫn người dùng. Claude làm theo `SKILL.md`.

## Cấu trúc skill

```
.claude/skills/postman-json/
  ├── SKILL.md      ← hướng dẫn cho Claude
  ├── README.md     ← hướng dẫn cho người dùng (file này)
  ├── scripts/
  │     ├── generate-postman.js   ← script chuyển đổi (Claude luôn chạy script này, không viết tay JSON)
  │     ├── lib/openapi.js        ← đọc spec JSON/YAML, chuyển schema OpenAPI sang JSON Schema
  │     └── test/                 ← test hồi quy: node --test .claude/skills/postman-json/scripts/test/generate-postman.test.js
  └── references/
        ├── conversion-rules.md       ← quy tắc map từng cột Markdown sang Postman, checklist kiểm tra
        ├── test-script-patterns.md   ← mẫu pm.test() cho từng Test Type
        ├── environment-template.md   ← format file environment
        └── postman-schema.md         ← cấu trúc Postman Collection v2.1
```

## Vị trí trong quy trình test API

```
Swagger/OpenAPI ──► api-test-design ──► (bạn review file .md) ──► postman-json ──► collection + environment JSON
```

- Đã có file test case đã review → dùng skill này.
- Chưa có test case, chỉ có Swagger → dùng `/api-test-design` trước, review file `.md`, rồi mới dùng skill này.

## Input

File Markdown theo đúng format output của `api-test-design`:

- Dòng tiêu đề `# API Test Cases — <Tên API> v<version>`, dùng để đặt tên collection.
- Dòng ``**Base URL**: `https://...` `` → giá trị `baseUrl` trong environment.
- Các bảng 14 cột theo đúng thứ tự:
  `TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes`
- Test Type chỉ dùng: `Happy`, `Validation`, `Auth`, `NotFound`, `Boundary`, `Security`.
- Ký tự `|` trong ô phải viết là `\|`.

Chi tiết từng cột xem `.claude/skills/api-test-design/references/output-template.md`.

## Cách dùng

Gọi trực tiếp:

```
/postman-json test-case-api/2026-10-03_14-30-00-user-service.md
```

Hoặc nói tự nhiên: "Chuyển file test case này sang Postman", "Tạo file Postman từ `test-case-api/...md`",
"Xuất ra Postman JSON để chạy Newman".

Claude sẽ chạy script:

```
node .claude/skills/postman-json/scripts/generate-postman.js <file.md> [tham số]
```

| Tham số | Ý nghĩa | Mặc định |
|---|---|---|
| `--out-dir <thư mục>` | Nơi ghi 2 file output | Cùng thư mục với file `.md` |
| `--name "<tên>"` | Tên collection | Lấy từ dòng tiêu đề + " Test Suite" |
| `--base-url <url>` | Ghi đè baseUrl | Lấy từ dòng `**Base URL**:` |
| `--file-base <tên>` | Đặt tên file chính xác: `<tên>-collection.json`, `<tên>-environment.json` | `<yyyy-mm-dd_hh-mm-ss>-<tên-api>-collection.json`, `...-environment.json` (xem mục Output) |
| `--flat` | Giữ đúng thứ tự dòng trong file (Module → request), dời case `[ORDER: run after TC_xxx]` ra ngay sau `TC_xxx`. Claude tự bật khi file có `[ORDER:` | Tắt (thư mục 3 cấp) |
| `--spec <file\|url>` | Spec OpenAPI/Swagger (JSON hoặc YAML) dùng để kiểm tra schema response | Lấy từ dòng `**Source spec**:` |
| `--no-schema` | Tắt kiểm tra schema response | Bật (nếu có spec) |
| `--strict-formats` | Kiểm tra cả `format` (date-time, email, uri, uuid...) | Tắt |
| `--max-time <ms>` | Ngưỡng thời gian phản hồi; `0` = không kiểm tra | `2000` |
| `--dry-run` | Chỉ phân tích, in tóm tắt và cảnh báo, **không ghi file** | Tắt |

Bạn có thể yêu cầu Claude dùng tham số, ví dụ "xuất ra thư mục `postman/`, base URL là `https://staging.hoctest.com`".

## Skill sẽ làm gì

1. **Kiểm tra trước** (khi file có từ 20 test case trở lên): chạy `--dry-run`, cho bạn xem tóm tắt gồm số module,
   số request, biến tự động / biến phải điền tay, số dòng `[NEEDS REVIEW]` và các cảnh báo. Bạn đồng ý thì mới
   ghi file.
2. **Sinh collection** theo cấu trúc thư mục 3 cấp:
   ```
   Collection
   └── Module (Users)
       └── Endpoint (POST /api/users)
           └── Test Type (Happy / Validation / Auth / ...)
               └── TC_USERS_POST_001 — <Description>
   ```
   Mỗi dòng trong bảng là đúng 1 request. Tên request bắt đầu bằng TC_ID để truy vết.
   File có case `[ORDER: run after TC_xxx]` (ví dụ GET sau DELETE) thì dùng `--flat`: mỗi module là 1 thư mục, request
   xếp đúng thứ tự file, case `[ORDER]` được dời ra ngay sau case đích.
3. **Sinh pm.test()** cho mỗi request:
   - Status code đúng với Expected Status (nhiều mã như `200/204` thì chấp nhận một trong các mã).
   - **Schema response đúng theo spec**: body JSON phải khớp schema mà spec khai báo cho đúng mã status trả về
     (kiểu dữ liệu, field bắt buộc, enum, nullable...). Bắt được lỗi ở cả những field không ai viết assertion.
   - Thời gian phản hồi dưới `--max-time` (mặc định 2000ms; case ghi `[MAX-TIME: 10000]` ở Notes thì dùng ngưỡng riêng).
   - Kiểu dữ liệu field, khi Expected Response ghi dạng `` `id` (integer) ``, `` `email` (string) ``, `` `items` (array) ``...
     Đường dẫn có chỉ số mảng cũng được: `` `data.items[0].id` (integer) ``.
   - Header response: `` header `Content-Type` contains "application/json" ``, `` header `Location` present ``,
     `` header `X-Powered-By` absent ``.
   - Giá trị field: `` `user.email`="jane@hoctest.com" ``, kể cả có biến: `` `user.id`="{{createdUserId}}" ``.
   - Field không được có: `` `password` not present in response `` → key `password` không xuất hiện ở bất kỳ cấp nào.
   - Case `Auth`: JSON lỗi không chứa key `password`/`password_hash`/`secret`... (thông báo kiểu "Invalid email or
     password" vẫn pass).
   - Một số câu quen thuộc được nhận dạng, ví dụ "Error message indicates email is required", "JSON parse error".
   - Response không phải JSON (204, trang lỗi HTML) không làm hỏng cả script, chỉ các assertion cần JSON bị fail.
4. **Nối các request với nhau**:
   - Theo chỉ dẫn `Save` trong Notes: ``Save `user.id` as `{{createdUserId}}` `` → lưu khi response 2xx.
   - File không có `Save` nào thì dùng quy tắc đoán: `Happy` + `POST` + 2xx có `id` → `{{<module số ít>Id}}`;
     API login trả token → `{{token}}`.
   - `{{runId}}`: giá trị mới mỗi lần chạy collection (request đầu tiên tự gán). Dùng cho email/username cần duy nhất
     để chạy lại không bị lỗi "đã tồn tại".
5. **Xử lý auth** (hỗ trợ Bearer/JWT, Basic, API key ở header hoặc query, cookie, header tuỳ chỉnh):

   | Header trong test case | Postman gửi |
   |---|---|
   | Không có | Không gửi credential (test 401 thiếu token) |
   | `Bearer {{token}}` | Token chung của collection |
   | `Bearer invalid_xyz`, `Bearer {{expired_token}}`... | Đúng token đó |
   | `Basic alice:s3cret`, `Basic {{username}}:{{password}}` | Basic auth, Postman tự mã hoá base64 |
   | `X-API-Key: {{apiKey}}`, `Cookie: session={{sessionId}}`, query `api_key={{apiKey}}` | Gửi đúng nguyên văn |
   | Rỗng, `Bearer` không có token, `Basic <base64>`, scheme khác | Gửi đúng nguyên văn, không thêm token |

6. **Body theo Content-Type** của case:

   | Content-Type | Viết body trong ô Request Body | Postman gửi |
   |---|---|---|
   | `multipart/form-data` | `` `{"name":"Jane","avatar":"@file:test-files/avatar.png"}` `` | form-data, `@file:` là file upload |
   | `application/x-www-form-urlencoded` | `` `{"user":"jane","pass":"x"}` `` hoặc `` `user=jane&pass=x` `` | form urlencoded |
   | `application/xml` | `` `<user><name>Jane</name></user>` `` | raw XML |
   | `text/plain` hoặc loại khác | bất kỳ | raw, đúng nguyên văn |
   | JSON / không ghi | JSON (JSON lỗi cố ý vẫn gửi nguyên văn) | raw JSON |

   Query string được tự encode (`&`, `#`, `+`, khoảng trắng, tiếng Việt...) nên payload SQLi/XSS trong query không làm
   vỡ URL.

7. **Sinh file environment** chứa mọi biến `{{...}}` được dùng. Token để trống, đánh dấu loại secret.
8. **Cảnh báo** (dòng `[WARN]`) khi:
   - Không tải được spec (schema không được kiểm tra), hoặc endpoint trong case không có trong spec.
   - Body multipart không viết dạng JSON object.
   - Dòng không đủ 14 cột, thường do quên escape `|`. **Request của dòng đó sẽ sai**, nên sửa file `.md` rồi chạy lại.
   - TC_ID bị trùng.
   - Endpoint có `{id}` nhưng cột Path/Query Params không có giá trị → tự đổi thành `{{id}}` để bạn điền.
   - Không tìm thấy Base URL → dùng tạm `https://api.example.com`.
   - File output đã tồn tại và sẽ bị ghi đè.
   - File có case `[ORDER: ...]` nhưng không chạy `--flat` (case đó có thể chạy trước case nó phụ thuộc).
   - Các case `[ORDER: ...]` trỏ vòng tròn vào nhau (được xếp xuống cuối).

## Output

2 file JSON, mặc định nằm cùng thư mục với file test case, ví dụ:

```
test-case-api/
  ├── 2026-10-03_14-30-00-user-service.md                    ← input
  ├── 2026-10-03_15-02-41-user-service-collection.json       ← collection (thời điểm chạy convert)
  └── 2026-10-03_15-02-41-user-service-environment.json      ← environment
```

Quy tắc đặt tên:
- Mặc định: **thời điểm chạy** (`yyyy-mm-dd_hh-mm-ss`) + tên API lấy từ dòng tiêu đề của file test case.
- Có `--file-base <tên>` → dùng đúng `<tên>-collection.json` / `<tên>-environment.json`.

Mỗi lần chạy sinh 1 cặp file mới, nên không bao giờ ghi đè collection cũ, kể cả khi convert lại cùng một file `.md`.
Collection sinh từ bộ test case nào được ghi trong mô tả của collection (`Converted from <tên file .md>`).

## Import và chạy

**Postman:**
1. Mở Postman → **Import** → kéo thả cả 2 file.
2. Chọn environment vừa import ở góc trên bên phải.
3. Điền các biến cần điền tay. Danh sách nằm trong mô tả của collection, dòng
   `[NEEDS REVIEW] Fill these environment variables before running: ...`, thường là `token`, `expired_token`,
   `other_user_token`.
4. Chạy cả collection **theo thứ tự** bằng Collection Runner. Các biến như `userId` được request trước gán tự động,
   nên chạy lẻ 1 request ở giữa có thể lỗi vì biến chưa có giá trị.

**Newman (CI):**

```
newman run 2026-10-03_15-02-41-user-service-collection.json -e 2026-10-03_15-02-41-user-service-environment.json
```

Token có thể truyền lúc chạy, không cần ghi vào file: `--env-var "token=<giá trị>"`.

Thêm khi cần:
- Có case upload file: `--working-dir <thư mục chứa file>` (đường dẫn `@file:` tính từ thư mục này).
- Xuất kết quả cho CI: `--reporters cli,junit --reporter-junit-export results.xml`.

Trong Postman app, case upload file cần chọn lại file ở tab Body (Postman không tự tìm theo đường dẫn tương đối).

## Lưu ý và giới hạn

- Skill không bịa thêm request hay assertion ngoài nội dung bảng. Muốn kiểm tra kỹ hơn thì viết Expected Response
  rõ ràng theo cú pháp assertion của `api-test-design` (`references/output-template.md`), ví dụ
  `` `user.id` (integer); `user.email`="jane@hoctest.com" ``. Expected Response viết tự do ("Tạo user thành công") chỉ sinh
  được assertion status code và thời gian phản hồi.
- Dòng có `[NEEDS REVIEW]` vẫn được sinh request, kèm comment `// TODO` trong script test. Nên xử lý hết trước khi
  dùng kết quả chạy để kết luận pass/fail.
- Chuỗi dài viết dạng `<256 x 'a'>` được sinh lúc chạy. Placeholder dạng mô tả (ví dụ `"<65-char string>"`) thì bị
  gửi nguyên văn, hãy đổi sang dạng `<N x 'c'>` trước khi convert.
- Script map cột theo **vị trí**, không theo tên cột. Đừng đổi thứ tự 14 cột.
- Kiểm tra schema mặc định bỏ qua `format` (nhiều API trả `2026-10-04 09:54:12` cho field `date-time`). Muốn kiểm tra
  chặt thì yêu cầu Claude dùng `--strict-formats`. Case không muốn kiểm tra schema thì ghi `[NO-SCHEMA]` ở Notes.
- Spec YAML được đọc bằng parser có sẵn, không cần cài thêm; chưa hỗ trợ anchor/alias YAML (`&`, `*`) và `$ref` trỏ
  sang file khác. Gặp trường hợp đó, script cảnh báo và bỏ qua kiểm tra schema.
- Không commit token thật vào file environment. Spec và collection chứa URL nội bộ thì không gửi ra dịch vụ bên ngoài.
