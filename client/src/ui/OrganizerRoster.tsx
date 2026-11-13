import { useCallback, useEffect, useState } from "react";
import { AuthApiError } from "../api/auth";
import { getOrganizerRoster, type OrganizerRosterEntry } from "../api/roster";
import { formatBangkokDate } from "./format";

interface Props {
  eventId: string;
  onBack: () => void;
}

export function OrganizerRoster({ eventId, onBack }: Props) {
  const [entries, setEntries] = useState<OrganizerRosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setEntries(await getOrganizerRoster(eventId));
    } catch (cause) {
      setEntries([]);
      setError(cause instanceof AuthApiError && cause.code === "NOT_FOUND"
        ? "ไม่พบกิจกรรมนี้ หรือคุณไม่มีสิทธิ์ดูรายชื่อผู้ลงทะเบียน"
        : "โหลดรายชื่อผู้ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="dashboard-card" aria-labelledby="organizer-roster-heading">
      <p className="eyebrow">Organizer Workspace</p>
      <h1 id="organizer-roster-heading">รายชื่อผู้ลงทะเบียน</h1>
      <p className="intro">แสดงเฉพาะชื่อที่ใช้แสดงและเวลาที่สมัครของกิจกรรมที่คุณเป็นเจ้าของ</p>
      <div className="roster-actions">
        <button type="button" className="btn-secondary" onClick={onBack}>กลับไปกิจกรรมของฉัน</button>
        {error && <button type="button" className="btn-secondary" onClick={() => void load()}>ลองโหลดอีกครั้ง</button>}
      </div>
      <div className="event-list" aria-live="polite">
        {isLoading ? <p role="status">กำลังโหลดรายชื่อผู้ลงทะเบียน…</p>
          : error ? <p role="alert" className="login-error">{error}</p>
          : entries.length === 0 ? <p role="status">ยังไม่มีผู้ลงทะเบียนในกิจกรรมนี้</p>
          : <ol className="roster-list" aria-label="รายชื่อผู้ลงทะเบียน">
            {entries.map(entry => (
              <li className="event-card roster-entry" key={entry.registrationId}>
                <h2>{entry.participantDisplayName}</h2>
                <p>สมัครเมื่อ <time dateTime={entry.registeredAt}>{formatBangkokDate(entry.registeredAt)}</time></p>
              </li>
            ))}
          </ol>}
      </div>
    </section>
  );
}
