# QC AI Skills — API

Bộ skill Claude Code dành cho team QC để **test API**: từ file Swagger/OpenAPI sinh bộ test case dạng bảng Markdown, review, chuyển thành Postman Collection có sẵn assertion, rồi chạy bằng Postman/Newman và đếm kết quả theo test case.

**Cách gọi skill:** `/<tên-skill> <input>` (input là đường dẫn file hoặc link). Skill cũng tự kích hoạt khi bạn mô tả yêu cầu bằng lời (vd: "sinh test case API từ swagger này", "chuyển file test case sang Postman").

---

## Cấu trúc thư mục

```
qc-ai-skills-api/
├── .claude/skills/
│   ├── api-test-design/     # Skill sinh test case API từ OpenAPI/Swagger
│   │   ├── SKILL.md         #   hướng dẫn cho Claude
│   │   ├── README.md        #   hướng dẫn cho người dùng
│   │   └── references/      #   ma trận coverage, template output, thư viện dữ liệu test
│   └── postman-json/        # Skill chuyển test case Markdown → Postman Collection + environment
│       ├── SKILL.md
│       ├── README.md
│       ├── references/      #   quy tắc chuyển đổi, mẫu pm.test(), schema Postman
│       └── scripts/         #   generate-postman.js (script chuyển đổi) + test/ (test hồi quy)
├── outputs/
│   ├── count_tc_results.js  # Đếm pass/fail theo test case từ kết quả Newman / Postman Runner
│   └── notes.md             # Ghi chú lệnh chạy nhanh
├── test-case-api/           # (tự tạo khi chạy) file test case .md + collection/environment .json
├── AGENTS.md                # Quy tắc làm việc cho agent
├── CLAUDE.md                # Nhúng AGENTS.md (@AGENTS.md) để Claude Code nạp quy tắc
└── README.md
```

> ⚠️ Spec, test case và collection có thể chứa URL/thông tin nội bộ của dự án bạn test — không gửi ra dịch vụ bên ngoài. Không ghi token thật vào file environment.

---

## Danh sách skill

| Skill | Dùng khi nào | Input | Output |
|---|---|---|---|
| `api-test-design` | Sinh bộ test case API để review / làm tài liệu | Spec OpenAPI 3.x hoặc Swagger 2.0 (JSON/YAML), file trong project hoặc link | 1 file Markdown `test-case-api/yyyy-mm-dd_hh-mm-ss-<ten-api>.md`, bảng 14 cột, 6 nhóm test |
| `postman-json` | Chuyển file test case **đã review** thành bộ test chạy được | File test case `.md` theo format của `api-test-design` | `...-collection.json` (Postman v2.1, có `pm.test()`) + `...-environment.json` |

Hướng dẫn chi tiết: [api-test-design/README.md](.claude/skills/api-test-design/README.md) · [postman-json/README.md](.claude/skills/postman-json/README.md)

---

## Quy trình test API

```
Swagger/OpenAPI ──► /api-test-design ──► review file .md ──► /postman-json ──► Postman / Newman ──► count_tc_results.js
```

### Bước 1 — Sinh test case

```
/api-test-design docs/user-service-openapi.yaml
```

- Mặc định sinh mức **Full**. Muốn bộ rút gọn thì nói "sinh bộ smoke test (lite)"; có thể giới hạn phạm vi (1 module, vài endpoint).
- Spec **trên 5 endpoint**: skill lập coverage plan và **dừng chờ bạn duyệt** rồi mới sinh.
- 6 nhóm test: `Happy`, `Validation`, `Auth`, `NotFound`, `Boundary`, `Security` (kèm business rule và side effect).
- Chỗ spec thiếu thông tin được đánh dấu `[NEEDS REVIEW: <lý do>]`, không bịa.

### Bước 2 — Review file test case

1. Xử lý mục **Blocking items** trước, sau đó tìm `NEEDS REVIEW` và xử lý từng dòng.
2. Xem **Coverage matrix** và **Not covered** để chắc không thiếu gì quan trọng.
3. Sửa tay hoặc nhờ Claude sửa ("bỏ hết case Security P3", "thêm case 409 khi email đã tồn tại").
4. Khi sửa tay, giữ đúng quy ước để `postman-json` đọc được: đủ 14 cột đúng thứ tự, `|` trong ô viết `\|`, ô trống ghi `N/A`, chuỗi dài viết `<256 x 'a'>`, Expected Response theo cú pháp assertion (vd: `` `user.id` (integer); `password` not present in response ``).

Chi tiết quy ước: [api-test-design/README.md — Review test case](.claude/skills/api-test-design/README.md#review-test-case)

### Bước 3 — Sinh Postman collection

```
/postman-json test-case-api/2026-10-03_14-30-00-user-service.md
```

Claude chạy `node .claude/skills/postman-json/scripts/generate-postman.js <file.md> [tham số]`. Có thể yêu cầu thêm tham số bằng lời, vd: "xuất ra thư mục `postman/`, base URL là `https://staging.example.com`".

| Tham số | Ý nghĩa |
|---|---|
| `--out-dir <thư mục>` | Nơi ghi output (mặc định: cùng thư mục file `.md`) |
| `--base-url <url>` | Ghi đè `baseUrl` |
| `--flat` | Giữ thứ tự dòng trong file; tự bật khi file có `[ORDER: run after TC_xxx]` |
| `--spec <file\|url>` / `--no-schema` | Spec dùng kiểm tra schema response / tắt kiểm tra schema |
| `--max-time <ms>` | Ngưỡng thời gian phản hồi (mặc định 2000, `0` = bỏ kiểm tra) |
| `--dry-run` | Chỉ in tóm tắt + cảnh báo, không ghi file (tự chạy trước khi file có ≥ 20 case) |

Danh sách đầy đủ: [postman-json/README.md — Cách dùng](.claude/skills/postman-json/README.md#cách-dùng)

Mỗi lần chạy sinh 1 cặp file mới có timestamp, không ghi đè collection cũ.

### Bước 4 — Chạy test

**Postman:** Import cả 2 file → chọn environment → điền các biến cần điền tay (danh sách nằm trong mô tả collection, dòng `[NEEDS REVIEW] Fill these environment variables...`) → chạy cả collection **theo thứ tự** bằng Collection Runner → Export Results.

**Newman:**

```
newman run <...>-collection.json -e <...>-environment.json --env-var "token=<giá trị>" -r cli,json --reporter-json-export results.json
```

- Có case upload file: thêm `--working-dir <thư mục chứa file>`.
- Xuất cho CI: `-r cli,junit --reporter-junit-export results.xml`.

### Bước 5 — Đếm kết quả theo test case

Postman/Newman đếm theo **assertion**; script này đếm theo **test case** (1 request = 1 case, fail nếu có bất kỳ assertion nào fail hoặc request lỗi):

```
node outputs/count_tc_results.js results.json
```

Nhận cả file JSON report của Newman lẫn file Export Results của Postman Runner.

---

## Quy tắc làm việc của agent

Theo [AGENTS.md](AGENTS.md), agent luôn trình bày kế hoạch và chờ bạn xác nhận trước khi thực hiện yêu cầu.

Cần quy tắc riêng cho máy mình (vd: cách đọc spec từ hệ thống nội bộ, token...)? Tạo file `CLAUDE.local.md` ở thư mục gốc — Claude Code tự nạp file này và nó đã nằm trong `.gitignore`.

---

## Dành cho người bảo trì skill

### Test hồi quy của `postman-json`

Chỉ cần khi **sửa script** `generate-postman.js` / `lib/openapi.js` — người dùng skill thông thường không cần chạy.

```
node --test .claude/skills/postman-json/scripts/test/generate-postman.test.js
```

Bộ test dùng dữ liệu mẫu trong `scripts/test/fixtures/` (`cases.md`, `spec.yaml`) để kiểm tra: đọc spec YAML/OpenAPI/Swagger, mỗi dòng sinh đúng 1 request, `--flat`/`[ORDER]`, encode query/path, body theo Content-Type, auth, các loại assertion và tham số. Test end-to-end dựng mock server (cổng 4010) và chạy collection bằng Newman, kỳ vọng chỉ các case đánh dấu `EXPECTED-FAIL` bị fail — cần `npm i -g newman` (hoặc đặt `NEWMAN_PATH`), nếu không test này bị skip.

### Thêm skill mới

Mỗi skill đặt trong `.claude/skills/<tên-skill>/` với file `SKILL.md`. Frontmatter gồm `name`, `description` và `metadata` (`author`, `version` — vd `author: tuyenvo224`, `version: "1.0"`; tăng version khi sửa skill). Có thể kèm:

- `README.md` — hướng dẫn sử dụng cho người dùng
- `references/` — tài liệu tham khảo cho agent
- `scripts/` — script xử lý cố định (kèm `test/` nếu có)
- `assets/` — template/file dùng để sinh output

Sau khi thêm skill, nhớ cập nhật README này.
