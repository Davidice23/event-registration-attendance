import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getEvents, getOrganizerEvents, publishEvent, type EventSummary } from "../api/events";
import type { CurrentUser } from "../api/auth";

function formatBangkokDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Bangkok", timeZoneName: "short",
  }).format(new Date(value));
}

interface Props { user: CurrentUser; }

export function EventWorkspace({ user }: Props) {
  const organizer = user.role === "ORGANIZER";
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      setEvents(organizer ? await getOrganizerEvents() : await getEvents());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load events.");
    } finally {
      setIsLoading(false);
    }
  }, [organizer]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedLocation = location.trim();
    const seatCount = Number(capacity);
    if (!trimmedTitle || trimmedTitle.length > 120 || !trimmedDescription || trimmedDescription.length > 1000 || !trimmedLocation || trimmedLocation.length > 160 || !Number.isInteger(seatCount) || seatCount < 1 || seatCount > 2147483647 || !startsAt) {
      setError("ตรวจชื่อ รายละเอียด สถานที่ เวลา และจำนวนที่นั่งให้ถูกต้อง (จำนวนที่นั่งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป)");
      return;
    }
    const start = new Date(`${startsAt}:00+07:00`);
    if (!Number.isFinite(start.getTime())) {
      setError("กรุณาระบุวันและเวลาให้ถูกต้อง");
      return;
    }
    setBusy(true);
    try {
      await publishEvent({ title: trimmedTitle, description: trimmedDescription, startsAt: start.toISOString(), location: trimmedLocation, capacity: seatCount });
      setNotice("เผยแพร่กิจกรรมแล้ว");
      setTitle(""); setDescription(""); setStartsAt(""); setLocation(""); setCapacity("1");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เผยแพร่กิจกรรมไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-card" aria-labelledby="events-heading">
      <p className="eyebrow">{organizer ? "Organizer Workspace" : "Participant Workspace"}</p>
      <h1 id="events-heading">{organizer ? "จัดการกิจกรรมของฉัน" : "กิจกรรมที่เปิดเผยแพร่"}</h1>
      {organizer && <form className="event-form" onSubmit={handlePublish}>
        <h2>เผยแพร่กิจกรรม</h2>
        <label>ชื่อกิจกรรม<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>รายละเอียด<textarea required maxLength={1000} rows={4} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label>วันและเวลา (เวลาไทย ICT, UTC+7)<input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label>
        <label>สถานที่<input required maxLength={160} value={location} onChange={e => setLocation(e.target.value)} /></label>
        <label>จำนวนที่นั่ง<input required type="number" min={1} max={2147483647} step={1} value={capacity} onChange={e => setCapacity(e.target.value)} /></label>
        <button className="btn-primary" disabled={busy}>{busy ? "กำลังเผยแพร่…" : "เผยแพร่กิจกรรม"}</button>
      </form>}
      {notice && <p role="status" className="event-notice">{notice}</p>}
      {error && <p role="alert" className="login-error">{error}</p>}
      <div className="event-list" aria-live="polite">
        {isLoading ? <p role="status">กำลังโหลดกิจกรรม…</p> : events.length === 0 ? <p>{organizer ? "ยังไม่มีกิจกรรมของคุณ" : "ยังไม่มีกิจกรรมที่เผยแพร่"}</p> : events.map(item => <article className="event-card" key={item.id}>
          <h2>{item.title}</h2><p>{item.description}</p><dl>
            <div><dt>วันเวลา</dt><dd>{formatBangkokDate(item.startsAt)}</dd></div>
            <div><dt>สถานที่</dt><dd>{item.location}</dd></div>
            <div><dt>จำนวนที่นั่ง</dt><dd>{item.capacity}</dd></div>
          </dl>
        </article>)}
      </div>
    </section>
  );
}
