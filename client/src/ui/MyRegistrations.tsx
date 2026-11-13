import { useCallback, useEffect, useState } from "react";
import { getMyRegistrations, type MyRegistration } from "../api/registrations";
import { formatBangkokDate } from "./format";

export function MyRegistrations() {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRegistrations(await getMyRegistrations());
    } catch {
      setError("โหลดรายการของฉันไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="dashboard-card" aria-labelledby="my-registrations-heading">
      <p className="eyebrow">Participant Workspace</p>
      <h1 id="my-registrations-heading">กิจกรรมที่ฉันสมัคร</h1>
      {error && (
        <div className="registration-check" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-secondary" onClick={() => void load()}>ลองโหลดอีกครั้ง</button>
        </div>
      )}
      <div className="event-list" aria-live="polite">
        {isLoading ? <p role="status">กำลังโหลดรายการของฉัน…</p>
          : error ? null
          : registrations.length === 0 ? <p>ยังไม่ได้สมัครกิจกรรมใด</p>
          : <ul className="registration-list" aria-label="รายการที่สมัคร">
            {registrations.map(registration => (
              <li className="event-card" key={registration.id} data-registration-id={registration.id}>
                <h2>{registration.event.title}</h2>
                <dl>
                  <div><dt>วันเวลา</dt><dd>{formatBangkokDate(registration.event.startsAt)}</dd></div>
                  <div><dt>สถานที่</dt><dd>{registration.event.location}</dd></div>
                  <div><dt>สมัครเมื่อ</dt><dd>{formatBangkokDate(registration.registeredAt)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>}
      </div>
    </section>
  );
}
