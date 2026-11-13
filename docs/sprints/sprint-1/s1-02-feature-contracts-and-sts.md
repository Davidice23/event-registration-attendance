# S1-02 — Sprint 1 Feature Contracts & Software Test Specification

**สถานะ ณ 14 พ.ย. 2026:** v0.2 — ทีมยืนยันตามคำแจ้งของ Davidice23; เอกสารผ่าน PR #1; F-01–F-04 implement และ merge เข้า `staging` ผ่าน PR #8–#12; integrated local verification ล่าสุดผ่านบน tree ของ `staging`. ยังไม่มี reviewed release บน `main` หรือผล CI สำหรับ SHA ที่ทดสอบ; ดูรายละเอียดใน §7 และ [Sprint 1 index](README.md)<br>
**ใช้คู่กับ:** [S1-01 baseline](s1-01-product-scope-and-baseline.md) และ [System-Level SDS](s1-02-system-level-sds.md)<br>
**ขอบเขต:** เอกสารนี้เป็นสัญญาและ expected behavior สำหรับ implementation; ใช้ test IDs เดิมเทียบกับ test files/results จริงด้านล่างและใน PR ที่เกี่ยวข้อง

## 1. ข้อตกลงร่วม

- API ทุก route ด้านล่างอยู่ใต้ `/api`; success `{"data": ...}` และ errors `{"error":{"code":"...","message":"..."}}`; `204` ไม่มี body. `GET` ไม่แก้ข้อมูล. `POST` รับ JSON object; routes ที่ไม่ต้องใช้ข้อมูลให้ส่ง `{}`. ปฏิเสธ field/query ที่ไม่ประกาศ, JSON ผิดรูปหรือ UUID ผิดด้วย `400 VALIDATION_ERROR`
- สำหรับ `POST` ให้ตรวจ Origin ที่ตรง `APP_ORIGIN` และ JSON media type ก่อนทำ side effect: origin ไม่ตรง/หายให้ `403 CSRF_REJECTED`, ชนิดข้อมูลผิดให้ `415 UNSUPPORTED_MEDIA_TYPE`. บน protected route ที่ผ่าน precheck แล้ว ให้ตรวจ session → role → validate input → ตรวจขอบเขตทรัพยากร/กฎธุรกิจ; ไม่มี session คืน `401 UNAUTHENTICATED`, ผิด role คืน `403 FORBIDDEN`
- DTO: `CurrentUser={id,displayName,role}`; `EventSummary={id,title,description,startsAt,location,capacity}`; `MyRegistration={id,registeredAt,event:EventSummary}`; `RosterEntry={registrationId,participantDisplayName,registeredAt}`. วันที่/เวลาจาก API เป็น ISO 8601 UTC, IDs เป็น UUID, role เป็น `ORGANIZER`/`PARTICIPANT`. ไม่ส่ง email, hashes, raw tokens หรือ internal errors ใน DTO เหล่านี้
- DB ไม่พร้อมให้ `503 TEMPORARILY_UNAVAILABLE` โดยไม่เผย SQL/รายละเอียดภายใน; ข้อผิดพลาดที่ไม่คาดไว้ให้ `500 INTERNAL_ERROR`. ห้ามกลบข้อผิดพลาด DB เป็น `EVENT_FULL` หรือ `ALREADY_REGISTERED` ถ้าไม่พิสูจน์สาเหตุได้

## 2. F-01 — Auth & Identity

**Trace:** FR-01, BR-04, NFR-02 | **พึ่งพา:** User/Session migrations และบัญชีทดสอบจำลอง<br>
**UI:** `/login` รับ email/password, แสดงรหัสผิดแบบไม่เผยว่าบัญชีมีอยู่หรือไม่, นำไป `/events` หรือ `/organizer/events` ตาม role จาก server. เมื่อ refresh ให้ถาม current user; ปุ่ม logout นำกลับ `/login` และล้างข้อมูลส่วนตัวใน UI

| API | Input / สิทธิ์ | ผลที่คาด |
|---|---|---|
| `POST /api/auth/login` | `{email,password}` เป็น string ไม่ว่าง; trim/lowercase เฉพาะ email, ไม่ trim password; ไม่รับ role | `200` + `CurrentUser` และ session cookie ใหม่; รหัสผิด/ไม่พบบัญชี `401 INVALID_CREDENTIALS` แบบเดียวกัน; ไม่สร้าง session ใหม่ถ้าไม่สำเร็จ |
| `GET /api/auth/me` | session ที่ยังใช้ได้ทั้งสองบทบาท | `200` + `CurrentUser` จากฐานข้อมูล; ขาด/หมดอายุ/ถูก revoke คืน `401` |
| `POST /api/auth/logout` | `{}` และ session ที่ยังใช้ได้ | ลบ session ปัจจุบัน, clear cookie และคืน `204`; replay token เดิมเข้าถึง protected route ไม่ได้ |

**Data:** User เก็บ salted password hash; Session เก็บ token hash, owner และ expiry (8 ชม. absolute); login ใหม่ออก token ใหม่และเพิกถอน session เดิมที่มากับ request เมื่อสำเร็จ. ไม่เพิ่ม self-registration/reset.

| AC | ผลที่ต้องสังเกตได้ |
|---|---|
| AC-01 | Organizer และ Participant login ได้และ `/me` คืนตัวตน/role ที่ถูกต้อง ไม่เผย secret; login ใหม่แทน session เดิมได้ |
| AC-02 | รหัสผิด/บัญชีไม่พบได้ error แบบเดียวกันและไม่สร้าง session ใหม่; anonymous หรือ session หมดอายุเรียก protected API ไม่ได้ |
| AC-03 | Logout ทำให้ replay session เดิมไม่ได้; POST ที่ origin/media type ไม่ผ่านไม่แก้ข้อมูลหรือสร้าง session |

## 3. F-02 — Publish & Discover

**Trace:** FR-02, BR-01, BR-04, NFR-01, NFR-02 | **พึ่งพา:** F-01 และ Event migration<br>
**UI:** Organizer กรอกชื่อ รายละเอียด วันเวลา สถานที่และจำนวนที่นั่ง; หลัง API ยืนยันแสดงกิจกรรมในรายการของผู้จัด. Participant เห็นกิจกรรมที่เผยแพร่ใน `/events`; แสดง `Asia/Bangkok` และจำนวนรับ ไม่รับประกันว่ายังเหลือที่นั่งจนกว่าจะสมัครสำเร็จ

| API | Input / สิทธิ์ | ผลที่คาด |
|---|---|---|
| `POST /api/events` | Organizer; `{title,description,startsAt,location,capacity}` | `201` + `EventSummary`; สร้างและเผยแพร่ในครั้งเดียว; owner มาจาก session; body มี `organizerId` ถูกปฏิเสธ |
| `GET /api/events` | Participant; ไม่มี query | `200` + `EventSummary[]`; เรียง `startsAt ASC,id ASC` |
| `GET /api/organizer/events` | Organizer; ไม่มี query | `200` + `EventSummary[]` ของเจ้าของปัจจุบันเท่านั้น; เรียงแบบเดียวกัน |

**Validation/Data:** trim แล้ว `title` 1–120, `description` 1–1,000, `location` 1–160 ตัวอักษร (ความยาว string แบบเดียวกันที่ API); `startsAt` เป็นวันเวลาที่ parse/ตรวจปฏิทินได้พร้อม offset/`Z`; `capacity` เป็น JSON number จำนวนเต็ม 1–2,147,483,647 (ขอบเขต DB integer; ไม่แปลง string ใน API). UI แปลงค่าฟอร์มและวันเวลาจาก `Asia/Bangkok` ให้ถูกต้อง. Event มี FK `organizerId` และ `CHECK (capacity > 0)`; ไม่สร้าง draft, deadline หรือฟีเจอร์แก้ไข

| AC | ผลที่ต้องสังเกตได้ |
|---|---|
| AC-04 | Organizer เผยแพร่แล้วอ่าน event เดิมได้; Participant เห็น event นั้น; Organizer คนอื่นไม่เห็นในรายการของตน |
| AC-05 | ค่าผิด/ขอบเขตผิดได้ `400` และไม่สร้าง event; capacity 1 ผ่าน |
| AC-06 | Participant/anonymous เผยแพร่ไม่ได้; Organizer ส่ง owner ที่แอบอ้างไม่ได้; ไม่มีแถวหรือข้อมูลส่วนตัวรั่ว |

## 4. F-03 — Register & My Registrations

**Trace:** FR-03, BR-02, BR-03, BR-04, NFR-01, NFR-02 | **พึ่งพา:** F-01/F-02 และ Registration migration<br>
**UI:** Participant กดสมัครจาก `/events`; แสดงสำเร็จหลัง API ตอบและอ่าน `/my/registrations` ใหม่; แยกข้อความสมัครแล้วกับกิจกรรมเต็ม. ถ้าไม่รู้ว่าคำขอก่อนหน้าสำเร็จหรือไม่ ให้โหลดรายการตนก่อนลองใหม่ ไม่ retry POST อัตโนมัติ. ไม่มีการยกเลิกหรือปิดรับตามเวลาใน Sprint 1

| API | Input / สิทธิ์ | ผลที่คาด |
|---|---|---|
| `POST /api/events/:eventId/registrations` | Participant; event UUID และ body `{}` | `201` + `MyRegistration`; `404 NOT_FOUND` เมื่อไม่มีกิจกรรม; `409 ALREADY_REGISTERED` ถ้ามีรายการเดิม; `409 EVENT_FULL` ถ้าเต็มและยังไม่ได้สมัคร |
| `GET /api/my/registrations` | Participant; ไม่มี query/body | `200` + `MyRegistration[]` เฉพาะเจ้าของ session, เรียง `registeredAt DESC,id DESC`; ไม่เปิด route เลือก participant อื่นหรืออ่าน registration ด้วย ID ใน Sprint 1 |

**Data และลำดับใน transaction:** `READ COMMITTED` → ล็อก Event ตาม ID ด้วย `SELECT … FOR UPDATE` ผ่าน parameterized SQL → ถ้าไม่พบให้จบด้วย `404` → ตรวจรายการเดิมของ `(eventId,participantId)` → นับรายการใน **คำสั่งแยกหลัง lock** → ถ้าเต็มคืน `409 EVENT_FULL` → insert โดยใช้ participant จาก session → commit → `201`. Duplicate มาก่อน full เพื่อให้คำตอบแน่นอนแม้มีทั้งสองเงื่อนไข; DB unique `(eventId,participantId)` เป็นข้อจำกัดเสริม หากจับ unique violation ให้แปลเป็น duplicate เฉพาะเมื่อเป็น constraint นี้ และ transaction ถูก rollback แล้ว. ไม่ทำ network call ใน transaction; หากรอ lock เกินเวลาหรือ DB ล้มเหลวให้ rollback เท่าที่ทราบและแจ้ง retry หลังเช็กผลจริง ไม่อ้างความสำเร็จก่อน commit. ดูเหตุผลและแหล่ง PostgreSQL ใน SDS §2

| AC | ผลที่ต้องสังเกตได้ |
|---|---|
| AC-07 | Participant สมัครได้หนึ่งครั้งและอ่านรายการเดิมหลังโหลดใหม่หรือเริ่มแอปใหม่โดยใช้ DB เดิม; กิจกรรมไม่พบให้ `404` โดยไม่มีแถวใหม่ |
| AC-08 | สมัครซ้ำทั้งแบบต่อเนื่องและพร้อมกันได้ `ALREADY_REGISTERED` สำหรับคำขอซ้ำ; ไม่สร้างแถวหรือกินที่นั่งซ้ำ แม้กิจกรรมเต็มแล้ว |
| AC-09 | เมื่อเต็มไม่มีแถวใหม่; เมื่อสอง Participant แข่งที่นั่งสุดท้าย มี `201` หนึ่งและ `EVENT_FULL` หนึ่ง และ DB เพิ่มหนึ่งแถวเท่านั้น |
| AC-10 | Anonymous/Organizer สมัครไม่ได้; Participant สวม ID คนอื่นหรือขออ่านรายการของผู้อื่นไม่ได้ และ response ไม่มีข้อมูลของอีกคน |

## 5. F-04 — Organizer Roster

**Trace:** FR-04, BR-04, NFR-01, NFR-02 | **พึ่งพา:** F-01/F-02/F-03<br>
**UI:** จากรายการกิจกรรมตน เปิด roster แล้วแสดงชื่อแสดงผลและเวลาที่สมัคร; แสดงสถานะไม่มีผู้ลงทะเบียนแยกจากไม่พบกิจกรรม. ไม่เพิ่มการเช็กชื่อหรือ export ใน Sprint 1

| API | Input / สิทธิ์ | ผลที่คาด |
|---|---|---|
| `GET /api/organizer/events/:eventId/registrations` | Organizer เจ้าของ Event; event UUID; ไม่มี query | `200` + `RosterEntry[]` เรียง `registeredAt ASC,registrationId ASC`; event ของผู้อื่นและ event ที่ไม่พบคืน `404 NOT_FOUND` รูปแบบเดียวกัน; ไม่ส่ง email, user/credential fields หรือรายชื่อของ event อื่น |

**Data:** อ่าน Event โดย scope `id + organizerId จาก session` ก่อน query registration สำหรับ Event นั้น; อ่าน `displayName` จาก User โดย select เฉพาะฟิลด์ที่กำหนด ไม่มี migration เพิ่มสำหรับ F-04

| AC | ผลที่ต้องสังเกตได้ |
|---|---|
| AC-11 | Organizer เจ้าของเห็น roster ที่มาจาก registration จริง; กิจกรรมตนที่ยังไม่มีผู้สมัครได้ `[]` |
| AC-12 | Organizer ข้ามเจ้าของได้ `404` แบบเดียวกับไม่พบ; Participant ได้ `403`; anonymous ได้ `401`; ไม่มี roster หรือข้อมูลส่วนตัวหลุดใน error |

## 6. Software Test Specification (STS)

ทดสอบด้วยบัญชี Organizer A/B และ Participant A/B คนละ session; API/DB และ E2E ใช้ PostgreSQL ทดสอบจริงที่แยกไว้ ไม่ mock ฐานข้อมูลเป็นหลักฐาน persistence. ตารางนี้ระบุขั้นตอน/ผลที่คาด; ผลรันล่าสุดและขอบเขตที่ยังค้างบันทึกไว้ใน §7

| Test ID | ระดับ / AC | ข้อมูลก่อนทดสอบและการกระทำ | ผลที่คาด |
|---|---|---|---|
| T-01 | API/DB / AC-01 | Login บัญชี A ทั้งสอง role; เรียก `/me`; login ใหม่โดยส่ง cookie เดิม | `200`, role ถูก, cookie flags ตรง env, ไม่มี secrets; token เดิมใช้ไม่ได้หลังออก token ใหม่ |
| T-02 | API/DB / AC-02 | รหัสผิด/ไม่พบ email; เรียก `/me` ด้วย anonymous/expired fixture; เรียก protected GET `/api/my/registrations`, `/api/organizer/events` และ `/api/organizer/events/{id}/registrations` โดยไม่มี session | `401` ตามกรณี, invalid credentials ตอบเหมือนกัน, session ใหม่ไม่ถูกสร้าง; protected routes ไม่ส่งข้อมูลส่วนตัว/roster หรือ body ที่บอกว่าทรัพยากรมีอยู่ |
| T-03 | API/DB / AC-03 | Logout ปกติแล้ว replay cookie เดิม; แยกทดสอบ POST login, logout, publish และ register โดยให้ Origin ผิด/หาย หรือส่ง form media type ทีละเงื่อนไข ส่วนข้อมูลและ session ที่จำเป็นต้องถูกต้อง; เก็บ session/domain row count ก่อนและหลังแต่ละกรณี. หลัง logout ที่ถูกปฏิเสธ ให้ส่ง `sid` เดิมไปที่ `GET /api/auth/me` | Logout ปกติได้ `204`, ล้าง `sid` และ replay คุกกี้เดิมได้ `401`. Origin ผิด/หายได้ `403 CSRF_REJECTED`; form media type กับ Origin ถูกต้องได้ `415 UNSUPPORTED_MEDIA_TYPE`. Login ที่ถูกปฏิเสธไม่สร้าง session, publish/register ไม่เพิ่มแถว, และ logout ที่ถูกปฏิเสธไม่มี `Set-Cookie` ที่ล้าง `sid`; `/api/auth/me` ด้วยคุกกี้เดิมยังได้ `200` และคืนตัวตนเดิม |
| T-04 | API/DB / AC-04 | Organizer A เผยแพร่; Participant A เปิดรายการ; Organizer A/B เปิดรายการผู้จัด | `201` และอ่าน ID เดิม; A เห็นในรายการผู้จัด, B ไม่เห็น |
| T-05 | Unit / AC-05 | ส่ง capacity 0, -1, 1.5, `"1"`, 2,147,483,648, 1 เข้าตัวตรวจ; เพิ่มวันที่ผิด/ไม่มี offset | ค่าผิดถูกปฏิเสธ; 1 และวันเวลาที่มี offset ถูกต้องผ่าน |
| T-06 | API/DB / AC-05, AC-06 | POST capacity ผิด, Participant/anonymous POST, Organizer ใส่ `organizerId` ของ B | `400`/`403`/`401` ตามกรณี; ไม่เกิด Event ใหม่และ error ไม่รั่วข้อมูล |
| T-07 | API/DB / AC-07 | Participant A สมัคร event ที่มีที่นั่ง; GET รายการด้วย request ใหม่; ลอง UUID ที่ไม่มีจริง | `201`, GET พบ ID เดิม; event ไม่พบ `404` และไม่เพิ่มแถว |
| T-08 | API/DB / AC-08 | สมัคร event capacity 1 สำเร็จแล้วส่งซ้ำ; ทดสอบอีก event ด้วยคำขอคู่ของ Participant เดียวกัน | คำขอซ้ำได้ `409 ALREADY_REGISTERED` แม้เต็ม; แต่ละ event มีแถวของ A หนึ่งเท่านั้น |
| T-09 | API/DB / AC-09 | Seed Event capacity 2 โดยมี Registration เดิมหนึ่งรายการของ Participant C; A/B ยังไม่เคยสมัคร Event นี้. ให้ controller connection ล็อกแถว Event เป้าหมาย แล้วส่งคำขอสมัครผ่าน route จริงจาก A/B คนละ session. ใช้ test-only DB instrumentation ผูกคำขอและ backend PID ที่ต่างกันเข้ากับคำสั่งล็อก Event ID เดียวกัน; ก่อนปล่อยล็อก ยืนยันว่าทั้งสอง PID กำลังรอ โดยเส้นทางตัวบล็อกของแต่ละ PID ไปถึง controller ได้ทั้งโดยตรงหรือผ่านอีกคำขอในคิวเดียวกัน (เช่น ไล่จาก `pg_blocking_pids()`). จัด connection ให้เพียงพอสำหรับ controller, ทั้งสองคำขอ และตัวสังเกตถ้าแยก connection | ถ้ายืนยันการรอของทั้งคู่บน Event เดียวกันไม่ได้ให้ test fail; การเริ่ม Promise พร้อมกันไม่ใช่หลักฐาน. หลังปล่อยล็อกต้องได้หนึ่ง `201` และหนึ่ง `409 EVENT_FULL` โดยไม่กำหนดผู้ชนะ; แถวเดิมยังอยู่ เพิ่มเพียงหนึ่งแถวของผู้ชนะ และจำนวนรวมเท่ากับ capacity. ให้คนที่แพ้ลองอีกครั้งแล้วต้องได้ `409 EVENT_FULL` โดยยอดไม่เปลี่ยน. ตั้ง timeout และปล่อยล็อก/rollback controller กับคืน connection ที่ใช้ทดสอบใน `finally` |
| T-10 | API/DB / AC-10 | Seed Participant A และ B ให้มี registration จริงคนละรายการ/คนละ Event; เก็บ snapshot IDs ของทั้งคู่. ทดสอบ anonymous และ Organizer POST register; จาก session B ส่ง `participantId=A` ใน body และ `?participantId=A` ใน query; GET `/api/my/registrations` ของ B ก่อน/หลังกรณีปฏิเสธ | anonymous `401`, Organizer `403`, field/query ที่ไม่ประกาศ `400`; ไม่มีแถวเพิ่มจาก request ปฏิเสธ; B ได้เฉพาะ ID ที่เป็นของ B (ชุด ID ตรง snapshot ของ B และไม่มี ID/ข้อมูลของ A), ส่วน A ยังอ่านรายการของ A ได้. การทดสอบต้องไม่ใช้รายการว่างเป็นหลักฐาน owner isolation |
| T-11 | API/DB / AC-11, AC-12 | A/B เป็น Organizer คนละกิจกรรม; A มีทั้ง event ว่างและ event ที่ Participant สมัครแล้ว; ทดสอบ owner/nonowner/missing/anonymous/Participant | Owner ได้ roster ที่ถูกต้องหรือ `[]`; nonowner/missing ได้ error รูปแบบเดียวกัน; anonymous/Participant ได้ `401`/`403`; ไม่มีข้อมูลส่วนตัวใน DTO/error |
| T-12 | API/DB + app restart / AC-04, AC-07, AC-11 | บันทึก Event และ Registration ID แล้วหยุดเฉพาะ app process ทดสอบ; เริ่มใหม่โดยต่อ DB เดิมและไม่ seed; login แล้วเรียกทั้ง event list, my registrations, roster | Event/Registration ID เดิมและข้อมูลสัมพันธ์ถูกต้องหลัง restart; DB ไม่ถูกสร้างใหม่ |
| T-13 | Browser E2E / AC-01, AC-03, AC-04, AC-07, AC-11 | Organizer A login/เผยแพร่ → logout → Participant A login/สมัคร/refresh รายการ → logout → Organizer A login/เปิด roster | มองเห็น journey ครบใน UI, event และรายการตรงกันหลัง refresh, roster ถูกคน; logout แล้วกลับหน้าที่ต้อง login ไม่ได้โดยไม่ auth ใหม่ |
| T-14 | Browser E2E / AC-08, AC-12 | Participant สมัคร event เดิมซ้ำ; เปิด URL roster ของ Organizer; ใช้ข้อมูลทดสอบที่รู้ล่วงหน้า | UI แสดงเหตุผลสมัครซ้ำและไม่เพิ่มรายการ; URL ต้องไม่แสดง roster ที่ไม่ได้รับสิทธิ์ (API negative tests ยังจำเป็น) |

TDD ที่จะเก็บเป็นหลักฐาน: รัน T-08/T-09 และกรณีข้ามเจ้าของของ T-10/T-11 ให้เห็น **red ที่ assertion ของพฤติกรรม** หลัง harness/fixture พร้อม → แก้ implementation → รัน **green** และ regression. T-09 ต้องแสดง contention ที่ lock จริง ไม่ใช่เพียง overlap ที่ client สังเกต; หาก instrumentation ไม่พร้อม ให้ทำ harness ให้ตรวจการ block ก่อนอ้างผล. การรันที่ล้มเพราะต่อ DB ไม่ได้ไม่นับเป็นหลักฐาน red. อย่าลด assertion หรือปิด test เพื่อให้ผ่าน

## 7. Definition of Done และหลักฐาน

| Feature | เงื่อนไขเฉพาะก่อนถือว่าเสร็จ |
|---|---|
| F-01 | Login/me/logout ใช้บัญชีจริงในฐานทดสอบ, session revoke/expiry ทำงาน, T-01–T-03 และ UI ส่วน auth ใน T-13 ผ่าน |
| F-02 | การ publish มาจาก Organizer จริงและ Participant อ่านได้, validation/ownership ผ่าน T-04–T-06, ตรวจ persistence และ UI ตาม T-12/T-13 |
| F-03 | การลงทะเบียนปกติ/ซ้ำ/เต็ม/พร้อมกันและสิทธิ์ผ่าน T-07–T-10; T-12–T-14 พิสูจน์อ่านกลับ/ข้อความใน UI ตามสัญญา |
| F-04 | Organizer เจ้าของเท่านั้นเห็น roster ที่มีข้อมูลขั้นต่ำ, T-11–T-14 ครอบคลุมสิทธิ์, การอ่านหลัง restart และ UI |

**ร่วมทุก feature:** ยืนยันสัญญาและเก็บ revision ก่อน code; ผูก Issue กับ requirement/AC/T IDs; รัน build/test จริงบน commit ที่ระบุ; บันทึก test file/name, คำสั่ง, ผล pass/fail/skip และ SHA; ผ่าน teammate review ที่อธิบายสิ่งที่ตรวจ และรวมเข้า sprint staging. เมื่อมี scaffold ให้ README ระบุ setup, env names (ไม่ใช่ค่า secret), คำสั่ง install/run/build/migrate/seed/test ที่ตรวจจาก scripts จริง; migrations ต้อง versioned, seed/test data ต้องสังเคราะห์และทำซ้ำได้โดยไม่แตะ production. บันทึกข้อจำกัด/skipped tests และเหตุผล; ห้ามอ้าง test/peer review จาก AI หรือจากผลบน SHA อื่นแทนหลักฐานจริง

**ระดับ Sprint:** ทดสอบรวม, เก็บภาพการใช้งานปกติ/อ่านข้อมูลเดิม/กรณีปฏิเสธ, เก็บตัวอย่าง test จริงสำหรับกฎธุรกิจและสิทธิ์ พร้อม Issue→PR ที่เสร็จอย่างน้อยสองสาย. รวม reviewed release PR เข้า `main` และยืนยัน tag/SHA กับผลจริงบน release ก่อนใช้เป็นฐาน Lab 5. ไม่อ้างว่าอาจารย์ตรวจรับโดยไม่มีหลักฐาน

### 7.1 Integrated execution record (2026-11-14)

ทดสอบบน commit `6b77db32506c08ec569b9ad795ca3cad9ffe5bda`; `staging` อยู่ที่ merge commit `6c2325e4370226f1f2c14358002465e9725cd818` และมี tree เดียวกัน `37a1d25a2bbdaef7d5aa5ac0e0cc52d04308801b`. Environment: Node.js 24.14.0, npm 11.9.0, PostgreSQL 18.1 ใน dedicated local test container, Microsoft Edge (`E2E_BROWSER_CHANNEL=msedge`). Integration/E2E ใช้เฉพาะ loopback test database `event_registration_test` บน port 5434; ไม่ใช้ dev/production DB.

| Command | Coverage / observed result | Status |
|---|---|---|
| `npm test` | Safety 6/6; client 21/21 (4 files); server 39/39 (8 files) | PASS |
| `npm run test:integration` | PostgreSQL-backed integration suite, 27/27 (4 files); migrations applied to isolated test DB | PASS |
| `npm run test:e2e` | 8/8, zero skipped; includes T-13/T-14 registration, owner roster, empty roster, and denied-access flows | PASS |
| `npm run build` | Client TypeScript/Vite and server TypeScript builds | PASS |
| `npm run db:validate` | Prisma schema validation | PASS |

These are local command results, not GitHub Actions results. No PR-triggered GitHub Actions run was returned for the tested commit. The run record is aggregate; preserve the per-test ID → file/test name mapping in the feature PR descriptions and attach the required human screenshots/checklist before release. No screenshot/manual visual review is claimed in this record.

**บันทึกตอนดำเนินการจริง:** `Test ID → file/test name → command or CI link → expected/actual → PASS/FAIL/SKIP → exact SHA`. Feature implementation/review evidence: [PR #8](https://github.com/Davidice23/event-registration-attendance/pull/8)–[#12](https://github.com/Davidice23/event-registration-attendance/pull/12); consolidated GitHub review status is in [Sprint 1 index](README.md). Issues #2–#6 remain open because their PRs merged into `staging`; close references belong on the eventual release PR to `main`. There is no release SHA/tag yet.

**แยกจาก Lab 5:** Sprint 1 DoD จบที่ reviewed release บน `main` พร้อม SHA/tag และหลักฐานที่ตรงกัน; ไม่รวม Docker, GCP deployment หรือการผ่าน R-01–R-12/C-01–C-06. เมื่อเริ่ม Lab 5 ให้ทำ requirement-to-evidence matrix ใน `docs/labs/lab-05/deployment.md` และรายงานแต่ละข้อจาก CI/deployed system ตาม handout; เอกสาร Sprint 1 หรือผลทดสอบ local ไม่ใช่หลักฐานว่า Lab 5 ผ่าน

**บันทึกการยืนยัน:** Davidice23 แจ้งว่าทั้งคู่ยืนยัน Sprint 1 v0.2 แล้ว ดูที่ [บันทึกการยืนยันใน System-Level SDS §6](s1-02-system-level-sds.md); ไม่ใช่ PR review หรือผลทดสอบ

**จุดให้ทีมตรวจ:** ขอบเขต field/เวลาเริ่มที่ยังไม่ปิดรับอัตโนมัติ, อายุ session และกติกา Origin, ลำดับ duplicate ก่อน full, roster ขั้นต่ำและ `404` ข้ามเจ้าของ, ตลอดจนกลไกทดสอบการแข่งที่นั่งสุดท้าย. หากแก้พฤติกรรมหลังอนุมัติ ให้บันทึก revision และเหตุผลก่อนเขียนโค้ดในส่วนที่กระทบ

**บันทึกการปรับ v0.2 หลัง audit:** เพิ่มการพิสูจน์ว่า T-09 มีสอง request รอล็อกของ Event เดียวกันทั้งทางตรงหรือผ่านคิว, ทำ T-10 ด้วยข้อมูล A/B ที่ไม่ว่างและตรวจรายการ owner-scoped, ขยาย auth/CSRF negative tests, เพิ่ม README/reproducibility/evidence ใน DoD และชี้ Lab 5 R/C เป็นงานภายหลัง
