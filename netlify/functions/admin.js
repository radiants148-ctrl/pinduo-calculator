import crypto from "node:crypto";
import { json, loadUser, saveUser, status } from "./lib/common.js";

// Ручная выдача платного доступа: POST {id, days}, заголовок x-admin-key = ADMIN_KEY.
export default async (req) => {
  const key = process.env.ADMIN_KEY;
  if (req.method !== "POST" || !key || key.length < 16) return json(404, { error: "not_found" });
  const sent = Buffer.from(req.headers.get("x-admin-key") || "");
  const good = Buffer.from(key);
  if (sent.length !== good.length || !crypto.timingSafeEqual(sent, good)) return json(404, { error: "not_found" });
  try {
    const { id, days } = await req.json();
    if (!/^\d{1,20}$/.test(String(id)) || !(Number(days) >= 0 && Number(days) <= 800)) return json(400, { error: "bad_request" });
    const u = await loadUser(String(id));
    if (!u) return json(404, { error: "no_user" });
    u.paidUntil = Number(days) === 0 ? null : Date.now() + Number(days) * 86400000;
    await saveUser(String(id), u);
    return json(200, { ok: true, status: status(u) });
  } catch (e) {
    return json(400, { error: "bad_request" });
  }
};
