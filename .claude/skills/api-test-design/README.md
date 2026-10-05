# api-test-design

Skill đọc file OpenAPI/Swagger rồi sinh bộ **test case API dạng bảng Markdown**, độ phủ tối đa, để QA review trước khi
chuyển thành Postman collection chạy được.
File này hướng dẫn người dùng. Claude làm theo `SKILL.md`.

## Cấu trúc skill

```
.claude/skills/api-test-design/
  ├── SKILL.md      ← hướng dẫn cho Claude
  ├── README.md     ← hướng dẫn cho người dùng (file này)
  └── references/
        ├── test-categories.md    ← ma trận coverage bắt buộc cho 6 nhóm test, OWASP API Top 10, business rule, side effect
        ├── output-template.md    ← format file output, quy ước cột, cú pháp assertion/Save cho postman-json, ví dụ mẫu
        └── test-data-library.md  ← dữ liệu mẫu, giá trị biên, payload bảo mật, giá trị test auth/login
```

## Vị trí trong quy trình test API

```
Swagger/OpenAPI ──► api-test-design ──► (bạn review file .md) ──► postman-json ──► collection + environment JSON
```

- Chỉ cần test case để review/làm tài liệu → dùng skill này.
- Đã có file test case đã review, cần ra Postman → dùng `postman-json`.

## Input

- Spec **OpenAPI 3.x** hoặc **Swagger 2.0**, định dạng JSON hoặc YAML, là file trong project hoặc link tới spec.
- Spec càng đầy đủ (`required`, `minLength`/`maxLength`, `enum`, `format`, `readOnly`, `security`, mã lỗi, mô tả nghiệp vụ)
  thì test case càng chính xác và càng ít dòng `[NEEDS REVIEW]`.

## Cách dùng

```
/api-test-design docs/user-service-openapi.yaml
```

Hoặc nói tự nhiên:

- "Sinh test case API từ file `docs/openapi.json`"
- "Viết test case API cho module Orders trong swagger này"
- "Sinh bộ smoke test (lite) cho spec này" → chỉ sinh bộ rút gọn (Happy, validation field bắt buộc, 401, 404, security tối thiểu)

Mặc định skill sinh ở mức **Full** (đầy đủ nhất). Có thể giới hạn phạm vi ngay từ đầu (1 module, vài endpoint).

## Skill sẽ làm gì

1. **Đọc spec và lập "field inventory"**: với từng endpoint, liệt kê mọi input (path/query/header/body, kể cả field lồng
   nhau): kiểu, format, bắt buộc hay không, ràng buộc, `readOnly`/`writeOnly`, **vai trò** của field (id, email, URL, text
   hiển thị, role...) và các **quy tắc nghiệp vụ** đọc được từ phần mô tả.
2. **Lập coverage plan** theo ma trận: số case từng nhóm kèm danh sách cụ thể, và những gì **không** cover kèm lý do.
   Spec **trên 5 endpoint** thì skill **dừng lại chờ bạn duyệt** plan. Từ 5 endpoint trở xuống thì sinh luôn.
3. **Sinh test case** theo 6 nhóm, áp dụng ma trận bắt buộc **cho từng field**:

   | Test Type | Nội dung chính | Priority |
   |---|---|---|
   | `Happy` | Chỉ field bắt buộc, đủ field, từng giá trị enum quan trọng; kiểm tra kiểu field trả về, không lộ password | P1 |
   | `Validation` | Mỗi field: thiếu, `null`, sai kiểu, sai format/pattern/enum, vượt min/max; body `{}`, body sai kiểu, trùng dữ liệu | P1 / P2 |
   | `Auth` | Theo đúng kiểu auth của spec (Bearer/JWT, Basic, API key ở header/query, cookie, OAuth2 scope): thiếu, sai, sai định dạng, đặt sai chỗ, hết hạn, JWT bị sửa, role không đủ quyền (403), BOLA (truy cập tài nguyên người khác), token của user đã xoá | P1 / P2 |
   | `NotFound` | ID không tồn tại hoặc đã xoá, ở path, query **hoặc body**; xoá 2 lần | P1 |
   | `Boundary` | Chuỗi rỗng, chỉ khoảng trắng, 1 ký tự, max / max+1, unicode/emoji; số 0/âm/thập phân/tràn int32; email, ngày, mảng, phân trang, file upload, header param; thiếu body, sai Content-Type; 405 khi gọi method không khai báo, 406, header response (`Content-Type`, `Location`...) | P2 / P3 |
   | `Security` | Injection chọn theo vai trò field (SQLi, NoSQLi, XSS, template, path traversal, command, CRLF, `javascript:`/SSRF cho field URL, file upload độc hại, XXE cho body XML); CORS và security header; mass assignment; leo quyền; lộ dữ liệu; payload quá lớn; JSON lỗi; endpoint phá dữ liệu không cần auth | P1–P3 |

   Ngoài ra:
   - **Business rule**: mỗi quy tắc nêu trong mô tả spec (ví dụ "không được đổi email") có ít nhất 1 case đúng và 1 case sai.
   - **Side effect**: GET lại sau khi tạo/sửa, xoá 2 lần, kiểm tra request bị 401/403 không làm thay đổi dữ liệu, kiểm tra
     tác dụng của endpoint đặc biệt (reset, seed...). Notes của các case này bắt đầu bằng `[SIDE-EFFECT]`.
   - **Case thăm dò**: spec không khai báo giới hạn (ví dụ không có `maxLength`) thì skill vẫn thử 255/256 ký tự... và đánh
     dấu `[NEEDS REVIEW]`, chứ không bỏ qua.
4. **Khử trùng lặp** (luật D1–D10 trong `test-categories.md` §9): những cơ chế dùng chung như kiểm tra token, parse
   JSON, giới hạn kích thước body chỉ test đủ biến thể ở 1 endpoint đại diện; các endpoint khác giữ case smoke. Field
   hoặc payload lặp ở nhiều endpoint không bị test lại y hệt. Những gì đã gộp được ghi ở mục Not covered dạng
   "covered by ...".
5. **Tự kiểm tra** theo checklist (coverage + format) và sửa trước khi lưu.
6. **Lưu file** và báo: tổng số case theo nhóm, các mục `[NEEDS REVIEW]` **chặn chạy** cần xử lý trước.

## Output

- Thư mục `test-case-api/` ở **thư mục gốc project** (tự tạo nếu chưa có).
- Tên file `yyyy-mm-dd_hh-mm-ss-<ten-api>.md`, ví dụ `test-case-api/2026-10-03_14-30-00-user-service.md`.
- **Luôn 1 file duy nhất**, chia section theo `## Module: <tên>`, dù nhiều case đến đâu.
- Nếu bạn hoặc workflow chỉ định đường dẫn khác thì lưu theo đường dẫn đó.

Cấu trúc file:

| Phần | Nội dung |
|---|---|
| Đầu file | Spec nguồn, base URL, mức coverage (Full/Lite), tổng số case |
| Summary | Số case theo module × Test Type |
| Test data & pre-requisites | Tài khoản, bước setup, biến phải điền tay |
| Blocking items | Các `[NEEDS REVIEW]` phải xử lý trước khi chạy |
| Assumptions | Các giả định khi spec không nói rõ |
| Bảng test case | Mỗi endpoint 1 bảng 14 cột |
| Coverage matrix | Field × loại kiểm tra → TC_ID, để thấy ngay chỗ trống |
| Not covered | Những gì cố ý không cover và lý do |

14 cột: `TC_ID | Module | Endpoint | Method | Test Type | Priority | Pre-condition | Description | Headers | Path/Query Params | Request Body | Expected Status | Expected Response | Notes`.

### Ý nghĩa của `[NEEDS REVIEW]`

Skill không bịa thông tin spec không có. Gặp chỗ thiếu, skill vẫn sinh case và đánh dấu `[NEEDS REVIEW: <lý do>]`:

- Spec không khai báo schema lỗi, hoặc mã 401/403/404/413/415.
- Spec không khai báo giới hạn (độ dài, giá trị), nên case biên là case thăm dò.
- Cần dữ liệu đặc biệt: token hết hạn, email tài khoản mẫu...

Mục **Blocking items** liệt kê riêng các `[NEEDS REVIEW]` mà nếu không xử lý thì nhiều case khác sẽ fail theo (ví dụ sai
email user mẫu → không login được → toàn bộ case dùng `{{userToken}}` fail).

## Review test case

1. Mở file `.md` trong VS Code (bật preview) hoặc trên GitHub/GitLab.
2. Xử lý **Blocking items** trước, sau đó tìm (Ctrl+F) `NEEDS REVIEW` và xử lý từng dòng.
3. Xem **Coverage matrix** và **Not covered** để chắc không thiếu gì quan trọng.
4. Thêm, sửa, xoá dòng tuỳ ý, sửa tay hoặc nói với Claude ("bỏ hết case Security P3", "thêm case 409 khi email đã tồn tại").
5. Khi sửa tay, giữ đúng quy ước để `postman-json` đọc được:
   - Đủ 14 cột, đúng thứ tự. Test Type chỉ dùng: `Happy`, `Validation`, `Auth`, `NotFound`, `Boundary`, `Security`.
   - **Ký tự `|` trong ô viết là `\|`.** Ô trống ghi `N/A`.
   - JSON body viết trên 1 dòng trong backtick: `` `{"email":"jane@hoctest.com"}` ``.
   - Chuỗi dài viết dạng `<256 x 'a'>`, không viết mô tả kiểu `<chuỗi 256 ký tự>`.
   - **Expected Response** viết theo cú pháp để sinh được assertion tự động, các mệnh đề cách nhau bằng `;`:
     - `` `success`=true ``, `` `message`="Đúng nguyên văn" ``
     - `` `user.email`="jane@hoctest.com" ``, `` `data.count`=6 ``, `` `user.avatar`=null `` (đường dẫn có dấu `.`)
     - `` `user.id` (integer) ``, `` `token` (JWT string) ``, `` `users` is an array ``
     - `Error message indicates email is required`, `JSON parse error`, `no SQL error leaked`
     - `` `password` not present in response `` → kiểm tra key `password` không xuất hiện ở bất kỳ cấp nào trong JSON.
     - So sánh với biến được: `` `user.id`="{{createdUserId}}" `` (biến được thay giá trị lúc chạy).
   - **Lưu giá trị cho case sau** (token, id) ghi ở Notes: ``Save `data.token` as `{{token}}` and `data.user.id` as `{{adminId}}` ``.
     Token chính đặt tên `{{token}}`, các role khác `{{userToken}}`, `{{otherUserToken}}`.
   - **Dữ liệu chạy lại được**: field cần duy nhất (email, username...) ở case tạo mới dùng `{{runId}}`, ví dụ
     `jane+{{runId}}@hoctest.com`. Mỗi lần chạy collection có `runId` mới, nên chạy lại không bị lỗi "đã tồn tại".
6. Review xong, gọi `/postman-json <đường dẫn file .md>` để sinh Postman collection và environment.

## Lưu ý và giới hạn

- Skill dựa vào spec. Logic nghiệp vụ không có trong spec (ví dụ "mỗi user chỉ tạo 3 đơn/ngày") sẽ không được sinh, trừ khi
  bạn mô tả thêm cho Claude.
- Không sinh case race condition, deadlock, hiệu năng... trừ khi bạn yêu cầu (sẽ được ghi ở mục Not covered).
- Mã 409/422/429 chỉ dùng khi spec khai báo. Nếu không, skill dùng 400 và đánh dấu `[NEEDS REVIEW]`.
- Body không phải JSON được hỗ trợ: upload file (`multipart/form-data`, file ghi dạng `"@file:test-files/avatar.png"`),
  form urlencoded, XML. File upload để trong thư mục `test-files/` cạnh file test case, danh sách file cần chuẩn bị
  nằm ở mục "Test data & pre-requisites".
- Ngoài các assertion viết trong bảng, `postman-json` còn tự kiểm tra **schema response** theo spec (đọc từ dòng
  `**Source spec**:`), nên giữ đúng đường dẫn/URL của spec ở đầu file.
- Case cần chạy sau endpoint khác (ví dụ GET sau DELETE) có ghi `[ORDER: run after TC_xxx]`. `postman-json` sẽ tự
  dùng chế độ `--flat` để xếp case đó ngay sau `TC_xxx`.
- Spec không khai báo `security` thì Claude hỏi bạn 1 lần. Nếu bạn không trả lời, Claude mặc định dùng Bearer token.
- Spec chứa URL/thông tin nội bộ: không gửi file spec hoặc output ra dịch vụ bên ngoài.
