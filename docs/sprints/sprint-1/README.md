# Sprint 1 design baseline

เอกสารนี้เป็นดัชนีเอกสารขอบเขตและออกแบบ Sprint 1 ของ CPE334 Group Project — Theme 3: Event Registration and Attendance System

สถานะ ณ 14 พฤศจิกายน 2026: ทีมแจ้งยืนยันเอกสาร Sprint 1 v0.2 แล้ว. เอกสารผ่าน PR #1 และ implementation ของ F-01 ถึง F-04 รวมเข้า `staging` ผ่าน PR #8–#12. `staging` release source คือ merge commit `8f71d7f51c8adbaa252fc43007ebda6ac503d8d6` (tree `172327270e61bb8ca3b24bc2b7951d6b28687a50`); รันทดสอบ release candidate บน local commit `ac477dc3389ae5e108649a68a3c51d9d8b66ef9b` ซึ่งมี tree เดียวกัน. Reviewed release PR [#14](https://github.com/Davidice23/event-registration-attendance/pull/14) ได้รับ `APPROVED` จาก Khawpun124 และ merge เข้า `main` แล้ว; release SHA คือ `98c6c04cf72fa62f8f5be4bd699310f6bee734ad`. Issues #2–#6 ปิดจากการ merge PR #14. ไม่ได้สร้าง tag แยก; ใช้ SHA นี้เป็น release identifier. ไม่มีหลักฐานการตรวจรับจากอาจารย์.

## เอกสาร

1. [Product scope, preliminary requirements, traceability, and three-sprint baseline](s1-01-product-scope-and-baseline.md)
2. [System-Level Software Design Specification](s1-02-system-level-sds.md)
3. [Sprint 1 feature contracts and Software Test Specification](s1-02-feature-contracts-and-sts.md)

## ขอบเขตของชุดเอกสาร

เอกสาร #1 เป็น contract/STS สำหรับการทำงาน; ผล implementation และ verification ล่าสุดบันทึกไว้ด้านล่างและใน README หลัก. การ merge เอกสาร PR #1 และ feature PRs ไม่ใช่การตรวจรับจากอาจารย์หรือ release บน `main`. การยืนยันทีม v0.2 ในแชตบันทึกตามที่ Davidice23 แจ้ง และแยกจาก GitHub PR review.

## Implementation, review, and verification status

| PR | Scope | GitHub review evidence | Status |
|---|---|---|---|
| [#8](https://github.com/Davidice23/event-registration-attendance/pull/8) | Safe application scaffold (Issue #2) | Khawpun124: `APPROVED` | Merged to `staging` |
| [#9](https://github.com/Davidice23/event-registration-attendance/pull/9) | F-01 authentication/session (Issue #3) | Davidice23: `APPROVED` | Merged to `staging` |
| [#10](https://github.com/Davidice23/event-registration-attendance/pull/10) | F-02 publish/discover (Issue #4) | Khawpun124 requested changes, then `APPROVED` | Merged to `staging` |
| [#11](https://github.com/Davidice23/event-registration-attendance/pull/11) | F-03 registration/capacity (Issue #5) | Review discussion and final “Approved!!” comment by Davidice23; **no formal submitted review event** | Merged to `staging` |
| [#12](https://github.com/Davidice23/event-registration-attendance/pull/12) | F-04 Organizer roster (Issue #6) | Khawpun124: `APPROVED` | Merged to `staging` |

Issues [#2](https://github.com/Davidice23/event-registration-attendance/issues/2)–[#6](https://github.com/Davidice23/event-registration-attendance/issues/6) are closed by the merged release PR #14. The release PR was formally approved by Khawpun124. No other reviewer or instructor acceptance is inferred.

Integrated verification was rerun locally on commit `ac477dc3389ae5e108649a68a3c51d9d8b66ef9b`, tree `172327270e61bb8ca3b24bc2b7951d6b28687a50`, identical to `staging` merge commit `8f71d7f51c8adbaa252fc43007ebda6ac503d8d6`. On 2026-11-14 with Node 24.14.0, npm 11.9.0, PostgreSQL 18.1, and Microsoft Edge (`E2E_BROWSER_CHANNEL=msedge`), local results were: `npm test` safety 6/6 + client 21/21 + server 39/39; `npm run test:integration` 27/27; `npm run test:e2e` 8/8 with no skipped tests; `npm run build` passed; `npm run db:validate` passed. GitHub reported no combined status checks or PR-triggered Actions runs for the latest staging merge commit. These results are local, not CI or deployment evidence.

**Post-release record:** the team reports the release was rechecked before merge. Specifically, Davidice23 stated in chat on 2026-11-14 that it had been rechecked and merged, but no per-scenario visual checklist or screenshot files were attached. Therefore this is a user-reported check, not independently auditable visual evidence; do not infer which individual UI scenarios were inspected. The exact `main` SHA `98c6c04cf72fa62f8f5be4bd699310f6bee734ad` is the Sprint 1 handoff identifier. Local tests passed on the same runtime tree; GitHub reported no CI status checks or workflow runs. No instructor acceptance is claimed. Do not treat automated E2E results as human visual review.

## แหล่งข้อกำหนดหลัก

Group Work Specification, Project Deliverable 1 และ Lab 5 updated handout เป็นเกณฑ์; Student Guide และ Starter Kit ใช้เป็นตัวอย่างเท่านั้น
