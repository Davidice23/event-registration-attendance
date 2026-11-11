# S1-02 — System-Level Software Design Specification

**สถานะ:** v0.1 — ทีมยืนยันตามคำแจ้งของ Davidice23; จัดเตรียมสำหรับ PR แบบ local; ยังไม่มี PR review, implementation หรือผลทดสอบ<br>
**โครงการ:** Event Registration and Attendance System (Theme 3), เวิร์กช็อปมหาวิทยาลัยที่มีที่นั่งจำกัด<br>
**ฐานข้อกำหนด:** [S1-01 v0.1 (D-01 ถึง D-06)](s1-01-product-scope-and-baseline.md)<br>
**สัญญาและชุดทดสอบที่วางแผน:** [Sprint 1 Feature Contracts & STS](s1-02-feature-contracts-and-sts.md)

## 1. ขอบเขตและสถาปัตยกรรม

Sprint 1 ใช้บัญชีจำลองสองบทบาทและส่งมอบเส้นทาง Organizer เผยแพร่กิจกรรม → Participant เห็น/ลงทะเบียน/ดูรายการตน → Organizer เจ้าของดู roster. ไม่รวม draft/edit, ยกเลิก, ปิดรับตามเวลา, ปรับความจุ, เช็กชื่อ หรือรายงานการเข้าร่วม การเริ่มกิจกรรมไม่ปิดรับอัตโนมัติใน Sprint 1; ใช้กิจกรรมอนาคตเพื่อสาธิต

```text
Browser: React/Vite (แบบฟอร์มและหน้าตามบทบาท)
    │ HTTP JSON /api + session cookie; same origin
    ▼
Express/TypeScript: route → ตรวจ session/role/ownership → domain service
    │ Prisma + parameterized SQL ในจุดที่ต้องใช้ row lock
    ▼
PostgreSQL: Users, Sessions, Events, Registrations
```

- UI รับผิดชอบการนำทาง/ป้อนข้อมูล/แสดงผล แต่ไม่ตัดสินสิทธิ์หรือความจุ; backend ตรวจซ้ำเสมอ
- แยกโมดูล auth, events และ registration/roster ใน backend เดียว บังคับกฎธุรกิจใน service กลางและข้อจำกัดที่เหมาะสมใน DB ไม่จำเป็นต้องแยก microservices
- พัฒนาผ่าน proxy `/api` ของ Vite เพื่อให้ browser เรียก origin เดียว; production เสนอให้ Express เสิร์ฟ static build ของ UI และ API ผ่าน origin เดียว ไม่เปิด CORS ข้าม origin เป็นค่าเริ่มต้น
- React/Vite + Express/TypeScript + PostgreSQL/Prisma ตาม D-06 ช่วยให้ reuse แนวทาง deployment ได้ แต่ไม่ใช้โค้ดโดเมน TokTickIT กำหนดและล็อกเวอร์ชัน Node/npm/DB/Prisma จากสิ่งที่ติดตั้งและ build ได้จริงเมื่อเริ่ม scaffold พร้อม lockfile เดียวที่ root

## 2. โมเดลข้อมูลและกฎที่เก็บในฐานข้อมูล

| Entity | ฟิลด์หลัก | ความสัมพันธ์/ข้อจำกัด |
|---|---|---|
| `User` | `id` UUID, `email` canonical, `displayName`, `role`, `passwordHash` | Email trim/lowercase และ unique; บทบาท `ORGANIZER` หรือ `PARTICIPANT` อย่างเดียว; ไม่เก็บรหัสผ่าน plaintext |
| `Session` | `tokenHash`, `userId`, `createdAt`, `expiresAt` | `tokenHash` เป็นคีย์ unique; FK ไป User; index สำหรับหมดอายุ; เก็บเฉพาะ hash ของ opaque token |
| `Event` | `id` UUID, `organizerId`, `title`, `description`, `startsAt`, `location`, `capacity`, `createdAt` | FK ไป User, index `organizerId`; `capacity` เป็น DB integer พร้อม `CHECK (capacity > 0)`; ทุกแถวที่สร้างสำเร็จคือเผยแพร่แล้ว ไม่ต้องมี draft/status |
| `Registration` | `id` UUID, `eventId`, `participantId`, `registeredAt` | FK ไป Event และ User; unique `(eventId, participantId)`; index สำหรับรายการของ Participant; ทุกแถวเป็น active ใน Sprint 1 |

หนึ่ง Organizer มีหลาย Event; หนึ่ง Event มีหลาย Registration; หนึ่ง Participant มีหลาย Registration ข้าม Event. FK ชี้ User แต่ไม่พิสูจน์ role เอง: ผู้จัดและผู้ลงทะเบียนต้องมาจาก session ที่ผ่านการตรวจใน service ไม่มี route ลบหรือโอนเจ้าของใน Sprint 1. วันเวลาเก็บเป็น timestamp พร้อม timezone และ API ส่ง UTC ISO 8601; UI แสดง `Asia/Bangkok` ให้เห็นชัด

**ที่นั่งสุดท้าย:** ใช้ transaction เดียวที่ `READ COMMITTED` ล็อกแถว Event ด้วย `SELECT … FOR UPDATE` ก่อน แล้วใช้ **คำสั่งแยกหลังได้ lock** เพื่อตรวจซ้ำและนับ Registration; ทุกการสมัครใช้เส้นทางล็อกเดียวกัน นับแล้วจึง insert และตอบ `201` หลัง commit เท่านั้น ใช้ parameterized SQL ใน connection ของ transaction เดียวกัน ดูลำดับและ error precedence ใน F-03. ไม่ใช้ mutex ในหน่วยความจำหรือค่าที่ UI แสดงเป็นตัวรับประกัน. อ้างอิง [PostgreSQL: transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) และ [row-level locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)

**การต่อยอด:** Sprint 2 ต้องทำ migration ที่รักษาประวัติ cancellation และคงข้อจำกัดหนึ่ง active ต่อคู่ไว้ก่อนเปิด re-registration; ตัดสินรายละเอียดสถานะและ constraint ในสัญญา F-05/F-06 โดยให้การยกเลิกและแก้ capacity ใช้กติกาล็อกเดียวกัน. Sprint 3 เช็กชื่ออ้างอิง Registration และสรุปยอดภายใต้ ownership เดิม ยังไม่เพิ่ม schema สำหรับงานเหล่านี้ใน Sprint 1

## 3. UI, การยืนยันตัวตน และสิทธิ์

| หน้าจอ | ผู้ใช้และพฤติกรรม |
|---|---|
| `/login` | ฟอร์ม email/password; เมื่อสำเร็จนำไปหน้าตามบทบาท; ไม่บอกว่า email มีอยู่หรือไม่จากข้อความรหัสผิด |
| `/events`, `/my/registrations` | Participant ดูรายการกิจกรรมและกดสมัคร; อ่านรายการของตนผ่าน API ทุกครั้งที่เปิดหน้า |
| `/organizer/events`, `/organizer/events/new`, `/organizer/events/:eventId/registrations` | Organizer เห็นกิจกรรมตน, เผยแพร่จากฟอร์ม, ดู roster ของกิจกรรมที่เลือก |

แยก loading, empty, success และ error; แสดง validation ที่ช่องข้อมูล, ปิดปุ่มระหว่างส่ง, และไม่แสดงว่าสำเร็จจน API ยืนยัน. ถ้า `401` ให้ล้าง UI state และนำไป login; `403` แสดงไม่อนุญาต; `404` แสดงไม่พบโดยไม่เผยเหตุผลเรื่องเจ้าของ. ไม่เก็บรหัสผ่านหรือ session token ใน localStorage

| การกระทำ | ไม่ล็อกอิน | Participant | Organizer |
|---|---|---|---|
| Login | ได้ | ได้ | ได้ |
| Current user / logout | `401` | เฉพาะ session ปัจจุบัน | เฉพาะ session ปัจจุบัน |
| ดูกิจกรรมที่เผยแพร่ / สมัคร / ดูรายการฉัน | `401` | สมัครด้วยตัวตนตน; อ่านเฉพาะรายการตน | `403` |
| เผยแพร่ / ดูกิจกรรมผู้จัด / ดู roster | `401` | `403` | สร้างในนามตนและอ่านเฉพาะกิจกรรมตน; roster ข้ามเจ้าของคืน `404` |

- Password ใช้ password-hashing library แบบ Argon2id พร้อม salt/พารามิเตอร์ที่บันทึกใน hash; เลือกเวอร์ชันและค่าที่เหมาะกับ runtime ก่อน implementation ห้ามใช้ SHA-256 ตรง ๆ กับ password
- เมื่อ login สำเร็จ สร้าง token สุ่ม 32 bytes, เก็บ SHA-256 ของ token ใน Session และส่ง token เฉพาะ cookie `sid` (`HttpOnly`, `SameSite=Lax`, `Path=/`, ไม่มี `Domain`, `Secure` บน HTTPS production); ถ้ามี session cookie เดิมที่ยังใช้ได้ให้เพิกถอนเมื่อ login สำเร็จ แล้วออก token ใหม่
- Session มีอายุแบบ absolute 8 ชั่วโมง; backend อ่าน user/role จาก DB ทุกคำขอที่ต้อง auth และไม่รับ role/ID ที่ client อ้าง. Logout ลบ session record และล้าง cookie; token เดิมใช้ต่อไม่ได้. Cookie ไม่ใช่หลักฐานสิทธิ์หาก DB ไม่พบหรือหมดอายุ
- ป้องกัน CSRF: ทุก `POST /api/*` รวม login/logout/register ต้องมี `Origin` ตรงกับ `APP_ORIGIN` และ `Content-Type: application/json`; ไม่รับ origin อื่น/ไม่มี origin หรือชนิดฟอร์ม. Frontend เรียก same-origin; test client ส่ง origin ทดสอบที่ตั้งไว้. `GET` ไม่มีผลแก้ข้อมูล และ API response ที่มีตัวตน/ข้อมูลบัญชีให้ `Cache-Control: no-store`

## 4. ข้อตกลง API และการเก็บข้อมูลอย่างปลอดภัย

- prefix `/api`; success เป็น `{"data": ...}` ยกเว้น `204` ไม่มี body; error เป็น `{"error":{"code":"...","message":"..."}}` อาจมี `fields` เฉพาะ validation. ใช้ `401` เมื่อไม่มี session, `403` เมื่อผิดบทบาท, `404` เมื่อไม่พบ/ไม่ใช่เจ้าของใน roster, `409` เมื่อผิดกฎการสมัคร; รายละเอียดราย route ใน Feature Contracts
- ตรวจ body/query/UUID ตามสัญญาและไม่ใช้ค่าจาก client เพื่อเลือกเจ้าของ. ใช้ลำดับรายการที่แน่นอนด้วยวันเวลาแล้วตาม ID; UI รับข้อมูลจาก DTO ที่ระบุฟิลด์ ไม่ส่ง DB model ดิบ
- ไม่ log body ของ auth, cookie, password, connection string หรือ stack trace ใน response. DB/transaction ล้มเหลวให้ข้อความทั่วไปและไม่เดาว่ากิจกรรมเต็ม; หากไม่รู้ผลการสมัคร ให้ผู้ใช้โหลดรายการของตนก่อนตัดสินใจลองใหม่

## 5. Configuration, migration, test environment และ deployment

| ตัวแปรที่วางแผน | แหล่งค่าและการใช้งาน |
|---|---|
| `DATABASE_URL` | Secret; runtime/migration รับจาก local env ที่ไม่ commit หรือ secret store ของ GCP ภายหลัง |
| `APP_ORIGIN` | URL ที่ทีมควบคุม ไม่ใช่ secret; ใช้เทียบ Origin แบบ exact; dev เช่น origin ของ Vite ตาม README |
| `PORT`, `NODE_ENV` | ค่ารันไทม์; dev/test ตาม README, production ใช้ port จาก hosting และ HTTPS สำหรับ cookie |
| `TEST_DATABASE_URL` | Secret ของฐานทดสอบที่แยกจาก dev/cloud; runner ต้องปฏิเสธ DB production หรือ URL เดียวกับ runtime dev และใช้ฐานที่กำหนดไว้สำหรับทดสอบเท่านั้น |
| `DEMO_SEED_PASSWORD` | Secret สำหรับ local/demo seed ที่ผู้รันอนุญาต; ไม่มีค่าจริงใน Git; ไม่ seed production อัตโนมัติ |

สร้าง migration ที่ version ใน Git สำหรับตาราง FK/index/constraints; มี seed แบบทำซ้ำได้สำหรับ Organizer A/B และ Participant A/B ด้วยข้อมูลสังเคราะห์ ไม่ reset แถวที่ผู้ใช้สร้างและไม่ฝังรหัสผ่านจริง. Integration test ใช้ PostgreSQL จริงที่แยกไว้; จัดข้อมูลเฉพาะ test เพื่อให้รันซ้ำได้ ไม่ reset schema นอกฐานทดสอบที่ระบุ. เลือก Vitest และ Playwright เป็นเครื่องมือที่เสนอ; คำสั่งใน README เช่น `npm ci`, `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run db:migrate`, `npm run db:seed`, `npm run dev` เป็น **ชื่อที่วางแผน ยังไม่มีสคริปต์หรือผลการรัน** ให้ยืนยันและบันทึกคำสั่งจริงหลัง scaffold

Lab 5 เท่านั้น: บรรจุ UI/API ใน Docker; เสนอ Cloud Run + Artifact Registry + Cloud SQL for PostgreSQL + Secret Manager (reference stack ไม่ใช่ข้อบังคับ). ไม่เก็บ session/ข้อมูลใน container; migration เป็นขั้นแยกก่อนอัปเดต service ตามแผนที่ทีมตรวจ; CI ตรวจ PR เข้า staging และ `main`, release deploy จาก `main` เท่านั้น, บันทึก revision กับ SHA. ภายหลังปรับ Starter Kit ให้ตรงแอปและเขียน `docs/labs/lab-05/deployment.md` ไม่สร้างทรัพยากรหรือเปลี่ยน billing/IAM/DB จริงใน S1-02

## 6. จุดตรวจเอกสารก่อนส่งต่อ

- **บันทึกการยืนยัน S1-02 v0.1:** Davidice23 แจ้งในแชตว่า `ทั้งคู่ยืนยัน S1-02 v0.1` สำหรับ Davidice23 และ Khawpun124 ครอบคลุม System-Level SDS และสัญญา F-01–F-04 โดยไม่ได้แจ้งข้อแก้ไข บันทึกนี้มาจากคำแจ้งของ Davidice23 ไม่ใช่ GitHub PR review หรือการตรวจรับของอาจารย์
- ตรวจความสอดคล้องของ permission matrix, DTO, วันเวลา และ capacity/duplicate precedence กับสัญญา F-01–F-04; ทีมบันทึกคำยืนยัน/ข้อแก้ไขจริงสำหรับ **S1-02** แยกจากการอนุมัติ S1-01
- ก่อนโค้ด ให้นำเวอร์ชันเอกสารที่ทีมตรวจแล้วเข้า repository ผ่านขั้นที่ได้รับอนุญาต เพื่อมีประวัติ contract ก่อน implementation; สำหรับ Lab 5 ใช้ Sprint 1 release ที่ทดสอบและรีวิวแล้วบน `main` พร้อม tag/SHA เท่านั้น
- แหล่งข้อกำหนด: Group Work Specification §6, §8; Project Deliverable 1 §§3.3, 3.5–3.6; Lab 5 updated handout §4
