import { json, verifyTelegram, signToken, loadUser, saveUser, status } from "./lib/common.js";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  let data;
  try { data = await req.json(); } catch (e) { return json(400, { error: "bad_request" }); }
  try {
    if (!verifyTelegram(data, process.env.TELEGRAM_BOT_TOKEN)) return json(401, { error: "bad_login" });
    const id = String(data.id);
    if (!/^\d{1,20}$/.test(id)) return json(400, { error: "bad_request" });
    const now = Date.now();
    let u = await loadUser(id);
    if (!u) u = { firstLogin: now, paidUntil: null, day: null, month: null };
    u.name = String(data.first_name || "").slice(0, 60);
    u.username = String(data.username || "").slice(0, 60);
    u.lastLogin = now;
    await saveUser(id, u);
    const token = signToken({ id, exp: now + 30 * 86400000 });
    return json(200, { token, name: u.name, status: status(u, now) });
  } catch (e) {
    console.error("auth failed");
    return json(500, { error: "server" });
  }
};
