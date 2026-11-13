# Sprint 1 design baseline

เอกสารนี้เป็นดัชนีเอกสารขอบเขตและออกแบบ Sprint 1 ของ CPE334 Group Project — Theme 3: Event Registration and Attendance System

สถานะ ณ 14 พฤศจิกายน 2026: ทีมแจ้งยืนยันเอกสาร Sprint 1 v0.2 แล้ว. เอกสารผ่าน PR #1 และ implementation ของ F-01 ถึง F-04 รวมเข้า `staging` ผ่าน PR #8–#12. ล่าสุด `staging` อยู่ที่ merge commit `6c2325e4370226f1f2c14358002465e9725cd818`; integrated local tests ผ่านบน tree เดียวกัน (`37a1d25a2bbdaef7d5aa5ac0e0cc52d04308801b`). ณ เวลาตรวจ remote `main` ยังอยู่ที่ `da04e55533bf681579d85224079aba6d8302fb6a` (`Initial commit`). **Sprint 1 ยังไม่เป็น release:** ยังไม่มี release PR เข้า `main`, tag/SHA ของ release หรือการตรวจรับจากอาจารย์.

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

Issues [#2](https://github.com/Davidice23/event-registration-attendance/issues/2)–[#6](https://github.com/Davidice23/event-registration-attendance/issues/6) remain Open because these feature PRs target `staging`, not the default branch `main`. A release PR should include closing references for #2–#6; do not manually mark them complete before the release merge.

Integrated verification ran on `6b77db32506c08ec569b9ad795ca3cad9ffe5bda`; that commit's tree is identical to current `staging` tree `37a1d25a2bbdaef7d5aa5ac0e0cc52d04308801b` at merge commit `6c2325e4370226f1f2c14358002465e9725cd818`. On 2026-11-14 with Node 24.14.0, npm 11.9.0, PostgreSQL 18.1, and Microsoft Edge, local results were: `npm test` safety 6/6 + client 21/21 + server 39/39; `npm run test:integration` 27/27; `npm run test:e2e` 8/8 with no skipped tests; `npm run build` passed; `npm run db:validate` passed. No PR-triggered GitHub Actions run was returned for the tested commit. These results are local, not CI or deployment evidence.

**Remaining Sprint 1 release gates:** update and capture human visual/acceptance evidence for normal flow, persisted records, and denied access; create and review a release PR to `main`; run/verify the checks against the exact release commit; merge it and record its exact SHA/tag. No release or instructor acceptance is claimed yet.

## แหล่งข้อกำหนดหลัก

Group Work Specification, Project Deliverable 1 และ Lab 5 updated handout เป็นเกณฑ์; Student Guide และ Starter Kit ใช้เป็นตัวอย่างเท่านั้น
