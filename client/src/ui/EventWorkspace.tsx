import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getEvents, getOrganizerEvents, publishEvent, type EventSummary } from "../api/events";
import { classifyRegisterError, getMyRegistrations, registerForEvent, type MyRegistration } from "../api/registrations";
import type { CurrentUser } from "../api/auth";
import { formatBangkokDate } from "./format";

interface Props { user: CurrentUser; }

type Feedback = { tone: "success" | "info" | "error"; text: string };

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

  // Participant registration state. `myRegistrations === null` means "not known yet":
  // registering is blocked until the participant's own list has been (re)loaded.
  const [myRegistrations, setMyRegistrations] = useState<MyRegistration[] | null>(null);
  const [myRegistrationsFailed, setMyRegistrationsFailed] = useState(false);
  const [fullEventIds, setFullEventIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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

  const loadMine = useCallback(async (): Promise<MyRegistration[] | null> => {
    setMyRegistrations(null);
    setMyRegistrationsFailed(false);
    try {
      const mine = await getMyRegistrations();
      setMyRegistrations(mine);
      return mine;
    } catch {
      setMyRegistrationsFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!organizer) void loadMine();
  }, [refresh, loadMine, organizer]);

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

  async function handleRegister(item: EventSummary) {
    setFeedback(null);
    setPendingEventId(item.id);
    try {
      await registerForEvent(item.id);
      // Show success only after the API answered and the participant's own list was re-read.
      const mine = await loadMine();
      setFeedback(mine
        ? { tone: "success", text: `สมัครกิจกรรม “${item.title}” สำเร็จแล้ว` }
        : { tone: "success", text: `สมัครกิจกรรม “${item.title}” สำเร็จแล้ว แต่โหลดรายการของฉันไม่สำเร็จ กรุณากด “ตรวจรายการของฉัน”` });
    } catch (cause) {
      const outcome = classifyRegisterError(cause);
      switch (outcome.kind) {
        case "already-registered":
          await loadMine();
          setFeedback({ tone: "info", text: `คุณสมัครกิจกรรม “${item.title}” ไว้แล้ว ระบบไม่ได้สร้างรายการซ้ำ` });
          break;
        case "event-full":
          setFullEventIds(previous => new Set(previous).add(item.id));
          setFeedback({ tone: "error", text: `กิจกรรม “${item.title}” เต็มแล้ว สมัครไม่สำเร็จ` });
          break;
        case "not-found":
          setFeedback({ tone: "error", text: "ไม่พบกิจกรรมนี้แล้ว รายการกิจกรรมถูกโหลดใหม่" });
          await refresh();
          break;
        case "session-expired":
          setFeedback({ tone: "error", text: "เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่" });
          break;
        case "unknown": {
          // The POST may or may not have committed. Never retry it automatically:
          // check the participant's own list first and let them decide.
          const mine = await loadMine();
          if (mine?.some(registration => registration.event.id === item.id)) {
            setFeedback({ tone: "success", text: `ตรวจรายการของคุณแล้ว: การสมัคร “${item.title}” สำเร็จ` });
          } else if (mine) {
            setFeedback({ tone: "error", text: `ไม่แน่ใจว่าคำขอสมัคร “${item.title}” สำเร็จหรือไม่ ตรวจรายการของคุณแล้วยังไม่พบ หากต้องการให้กดสมัครอีกครั้ง` });
          } else {
            setFeedback({ tone: "error", text: `ไม่แน่ใจว่าคำขอสมัคร “${item.title}” สำเร็จหรือไม่ และโหลดรายการของคุณไม่ได้ กรุณากด “ตรวจรายการของฉัน” ก่อนลองใหม่` });
          }
          break;
        }
        case "rejected":
          setFeedback({ tone: "error", text: outcome.message });
          break;
      }
    } finally {
      setPendingEventId(null);
    }
  }

  const registeredEventIds = new Set((myRegistrations ?? []).map(registration => registration.event.id));

  function registerButton(item: EventSummary) {
    const registered = registeredEventIds.has(item.id);
    const full = fullEventIds.has(item.id);
    const label = registered ? "สมัครแล้ว" : full ? "เต็มแล้ว" : pendingEventId === item.id ? "กำลังสมัคร…" : "สมัคร";
    const disabled = registered || full || pendingEventId !== null || myRegistrations === null;
    return (
      <button type="button" className="btn-primary btn-register" disabled={disabled} onClick={() => void handleRegister(item)}>
        {label}
      </button>
    );
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
      {feedback && (feedback.tone === "error"
        ? <p role="alert" className="login-error registration-feedback">{feedback.text}</p>
        : <p role="status" className={`event-notice registration-feedback registration-feedback-${feedback.tone}`}>{feedback.text}</p>)}
      {!organizer && myRegistrationsFailed && (
        <div className="registration-check" role="alert">
          <span>โหลดรายการของฉันไม่สำเร็จ จึงยังสมัครไม่ได้</span>
          <button type="button" className="btn-secondary" onClick={() => void loadMine()}>ตรวจรายการของฉัน</button>
        </div>
      )}
      <div className="event-list" aria-live="polite">
        {isLoading ? <p role="status">กำลังโหลดกิจกรรม…</p> : events.length === 0 ? <p>{organizer ? "ยังไม่มีกิจกรรมของคุณ" : "ยังไม่มีกิจกรรมที่เผยแพร่"}</p> : events.map(item => <article className="event-card" key={item.id} aria-labelledby={`event-${item.id}`}>
          <h2 id={`event-${item.id}`}>{item.title}</h2><p>{item.description}</p><dl>
            <div><dt>วันเวลา</dt><dd>{formatBangkokDate(item.startsAt)}</dd></div>
            <div><dt>สถานที่</dt><dd>{item.location}</dd></div>
            <div><dt>จำนวนที่นั่ง</dt><dd>{item.capacity}</dd></div>
          </dl>
          {!organizer && registerButton(item)}
        </article>)}
      </div>
    </section>
  );
}
