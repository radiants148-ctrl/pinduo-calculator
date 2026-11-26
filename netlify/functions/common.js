import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const TRIAL_DAYS = 3;
export const TRIAL_PER_DAY = 10;
export const PAID_PER_MONTH = 100;
const DAY = 86400000;

export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function store() {
  return globalThis.__TEST_STORE || getStore({ name: "users", consistency: "strong" });
}

function b64u(buf) { return Buffer.from(buf).toString("base64url"); }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("no session secret");
  return s;
}

export function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}

export function readToken(header) {
  const m = /^Bearer\s+([\w-]+\.[\w-]+)$/.exec(header || "");
  if (!m) return null;
  const [body, mac] = m[1].split(".");
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p || typeof p.id !== "string" || !(p.exp > Date.now())) return null;
    return p;
  } catch (e) { return null; }
}

/** Проверка данных Telegram Login Widget. */
export function verifyTelegram(data, botToken, now = Date.now()) {
  if (!data || typeof data !== "object" || !botToken) return false;
  const hash = String(data.hash || "");
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  const check = Object.keys(data).filter((k) => k !== "hash" && data[k] != null)
    .sort().map((k) => k + "=" + data[k]).join("\n");
  const key = crypto.createHash("sha256").update(botToken).digest();
  const good = crypto.createHmac("sha256", key).update(check).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(good))) return false;
  const age = now / 1000 - Number(data.auth_date);
  return Number.isFinite(age) && age >= -60 && age <= 86400;
}

function dayKey(t) { return new Date(t).toISOString().slice(0, 10); }
function monthKey(t) { return new Date(t).toISOString().slice(0, 7); }

/** Что сейчас доступно пользователю. Время в UTC, сутки считаются по UTC. */
export function status(u, now = Date.now()) {
  const trialEnd = u.firstLogin + TRIAL_DAYS * DAY;
  const paid = Number(u.paidUntil) > now;
  const inTrial = !paid && now < trialEnd;
  const dayUsed = u.day && u.day.d === dayKey(now) ? u.day.n : 0;
  const monthUsed = u.month && u.month.m === monthKey(now) ? u.month.n : 0;
  let plan = "expired", limit = 0, used = 0;
  if (paid) { plan = "paid"; limit = PAID_PER_MONTH; used = monthUsed; }
  else if (inTrial) { plan = "trial"; limit = TRIAL_PER_DAY; used = dayUsed; }
  return {
    plan, limit, used, left: Math.max(0, limit - used),
    period: plan === "paid" ? "month" : "day",
    trialEndsAt: trialEnd, paidUntil: paid ? Number(u.paidUntil) : null,
    daysLeft: inTrial ? Math.max(1, Math.ceil((trialEnd - now) / DAY)) : 0
  };
}

export function bump(u, now = Date.now()) {
  const d = dayKey(now), m = monthKey(now);
  u.day = u.day && u.day.d === d ? { d, n: u.day.n + 1 } : { d, n: 1 };
  u.month = u.month && u.month.m === m ? { m, n: u.month.n + 1 } : { m, n: 1 };
  return u;
}

export async function loadUser(id) {
  return (await store().get("u:" + id, { type: "json" })) || null;
}
export async function saveUser(id, u) {
  await store().setJSON("u:" + id, u);
}

export function authed(req) {
  return readToken(req.headers.get("authorization"));
}
