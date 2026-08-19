// Este script corre dentro de GitHub Actions cada vez que content/site.json
// cambia. Compara lo que hay publicado contra content/.notified.json (un
// registro de lo que ya se envió por correo) y manda un email nuevo por cada
// nota o libro que todavía no se haya notificado.

const fs = require("fs");
const path = require("path");

const SITE_PATH = path.join(__dirname, "..", "content", "site.json");
const NOTIFIED_PATH = path.join(__dirname, "..", "content", ".notified.json");
const API_KEY = process.env.BUTTONDOWN_API_KEY;
const SITE_URL = process.env.SITE_URL || "";

if (!API_KEY) {
  console.error("Falta la variable BUTTONDOWN_API_KEY (agrégala como secreto del repositorio).");
  process.exit(1);
}

function slug(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}

const site = loadJson(SITE_PATH, {});
const notified = loadJson(NOTIFIED_PATH, { sentIds: [] });
const sentSet = new Set(notified.sentIds || []);

const items = [];

(site.blog || []).forEach(entry => {
  const id = "nota:" + slug(entry.title);
  items.push({
    id,
    subject: `Nueva nota: ${entry.title}`,
    body: `${entry.excerpt || ""}\n\nLee la nota completa aquí: ${SITE_URL}#bitacora`
  });
});

(site.works || []).forEach(work => {
  if ((work.status || "").toLowerCase() !== "publicado") return;
  const id = "obra:" + slug(work.title);
  items.push({
    id,
    subject: `Nuevo libro publicado: ${work.title}`,
    body: `${work.desc || ""}\n\nLee más en: ${SITE_URL}#obras`
  });
});

const pending = items.filter(item => !sentSet.has(item.id));

if (pending.length === 0) {
  console.log("No hay novedades nuevas que notificar.");
  process.exit(0);
}

async function sendEmail(item) {
  const res = await fetch("https://api.buttondown.com/v1/emails", {
    method: "POST",
    headers: {
      "Authorization": `Token ${API_KEY}`,
      "Content-Type": "application/json",
      "X-Buttondown-Live-Dangerously": "true"
    },
    body: JSON.stringify({
      subject: item.subject,
      body: item.body,
      status: "about_to_send"
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Buttondown respondió ${res.status}: ${text}`);
  }
  return res.json();
}

(async () => {
  for (const item of pending) {
    try {
      await sendEmail(item);
      sentSet.add(item.id);
      console.log(`Enviado: ${item.subject}`);
    } catch (err) {
      console.error(`No se pudo enviar "${item.subject}":`, err.message);
      // No lo marcamos como enviado, así se reintenta en el próximo push.
    }
  }
  fs.writeFileSync(NOTIFIED_PATH, JSON.stringify({ sentIds: Array.from(sentSet) }, null, 2));
})();
