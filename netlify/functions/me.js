import { json, authed, loadUser, status } from "./lib/common.js";

export default async (req) => {
  try {
    const t = authed(req);
    if (!t) return json(401, { error: "auth" });
    const u = await loadUser(t.id);
    if (!u) return json(401, { error: "auth" });
    return json(200, { name: u.name || "", status: status(u) });
  } catch (e) {
    console.error("me failed");
    return json(500, { error: "server" });
  }
};
