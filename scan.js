import { json, authed, loadUser, saveUser, status, bump } from "./lib/common.js";

const MODEL = "claude-haiku-5-5";
const MAX_B64 = 3_000_000;

const PROMPT = `Это скриншот корзины или страницы товара с Pinduoduo (Пиндодо). Верни ТОЛЬКО JSON-массив без пояснений и без markdown.
Каждый элемент: {"name": строка, "priceCny": число, "quantity": число, "weightKg": число или null, "freeShipping": true/false/null}.
Правила: бери только то, что реально видно на скриншоте. Название переведи на русский коротко (2-5 слов). priceCny это цена одной единицы в юанях. quantity по умолчанию 1. Вес указывай только если он написан на скриншоте, иначе null. freeShipping true только если видна отметка бесплатной доставки, иначе null. Ничего не выдумывай. Если товаров нет, верни [].`;

function clean(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 30).map((x) => {
    const price = Number(x && x.priceCny);
    const qty = Number(x && x.quantity);
    const w = x && x.weightKg != null ? Number(x.weightKg) : null;
    return {
      name: String((x && x.name) || "").slice(0, 80),
      priceCny: Number.isFinite(price) && price > 0 && price < 1e6 ? Math.round(price * 100) / 100 : null,
      quantity: Number.isInteger(qty) && qty > 0 && qty < 1000 ? qty : 1,
      weightKg: w != null && Number.isFinite(w) && w > 0 && w < 100 ? w : null,
      freeShipping: x && typeof x.freeShipping === "boolean" ? x.freeShipping : null
    };
  }).filter((x) => x.name || x.priceCny);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  try {
    const t = authed(req);
    if (!t) return json(401, { error: "auth" });
    const u = await loadUser(t.id);
    if (!u) return json(401, { error: "auth" });
    const st = status(u);
    if (st.plan === "expired") return json(403, { error: "expired", status: st });
    if (st.left <= 0) return json(429, { error: "limit", status: st });

    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: "bad_request" }); }
    const img = body && body.image;
    if (typeof img !== "string" || img.length < 100 || img.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(img)) {
      return json(400, { error: "bad_image" });
    }
    if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "unavailable" });

    // Сначала списываем попытку, чтобы параллельные запросы не обошли лимит.
    bump(u);
    await saveUser(t.id, u);

    let text = "";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
            { type: "text", text: PROMPT }
          ] }]
        })
      });
      if (!r.ok) throw new Error("upstream " + r.status);
      const j = await r.json();
      text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    } catch (e) {
      console.error("scan upstream failed");
      // возвращаем попытку
      u.day.n = Math.max(0, u.day.n - 1); u.month.n = Math.max(0, u.month.n - 1);
      await saveUser(t.id, u);
      return json(502, { error: "upstream", status: status(u) });
    }

    let items = [];
    const m = /\[[\s\S]*\]/.exec(text);
    if (m) { try { items = clean(JSON.parse(m[0])); } catch (e) { items = []; } }
    return json(200, { items, status: status(u) });
  } catch (e) {
    console.error("scan failed");
    return json(500, { error: "server" });
  }
};
