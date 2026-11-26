// Envía por Buttondown un correo por cada nota (blog) u obra publicada NUEVA.
// Guarda lo ya enviado en content/.notified.json para no repetir.
const fs = require('fs');

const KEY = process.env.BUTTONDOWN_API_KEY;
const SITE = (process.env.SITE_URL || 'https://www.christophersoule.com').replace(/\/$/, '');
if (!KEY) { console.log('Sin BUTTONDOWN_API_KEY; nada que hacer.'); process.exit(0); }

const site = JSON.parse(fs.readFileSync('content/site.json', 'utf8'));
let sent = { ids: [] };
try { sent = JSON.parse(fs.readFileSync('content/.notified.json', 'utf8')); } catch (e) {}
const first = !fs.existsSync('content/.notified.json');

const slug = s => 'x-' + Buffer.from(String(s)).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 40);
const items = [];
const reciente = d => new Date(d).getTime() >= Date.now() - 4 * 86400e3;
// Mismo identificador de nota que usa la página (assets/comun.js → noteSlug)
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const noteSlug = n => slugify((n.date || '') + ' ' + slugify(n.title).slice(0, 60));
(site.blog || []).forEach(n => items.push({ id: 'blog:' + slug(n.title + n.date), reciente: reciente(n.date), subject: n.title, body: `${n.excerpt || ''}\n\nLéela completa en ${SITE}/notas.html?n=${noteSlug(n)}` }));
(site.works || []).filter(w => (w.status || '').toLowerCase() === 'publicado')
  .forEach(w => items.push({ id: 'work:' + slug(w.title), reciente: reciente(w.date), subject: 'Nueva obra: ' + w.title, body: `${(w.desc || '').slice(0, 400)}...\n\n${w.buyLink ? 'Cómpralo: ' + w.buyLink : SITE}` }));

(async () => {
  // Primera ejecución: solo registra lo existente, no envía correos viejos.
  // Primera ejecución: registra lo viejo sin enviarlo, pero sí avisa de lo de los últimos 4 días.
  if (first) {
    sent.ids = items.filter(i => !i.reciente).map(i => i.id);
    fs.writeFileSync('content/.notified.json', JSON.stringify(sent, null, 2));
    console.log('Primera ejecución: registrado lo antiguo sin enviar.');
  }
  for (const it of items.filter(i => !sent.ids.includes(i.id))) {
    const res = await fetch('https://api.buttondown.com/v1/emails', {
      method: 'POST',
      headers: { Authorization: `Token ${KEY}`, 'Content-Type': 'application/json', 'X-Buttondown-Live-Dangerously': 'true' },
      body: JSON.stringify({ subject: it.subject, body: it.body, status: 'about_to_send' })
    });
    console.log(it.id, res.status);
    if (res.ok) sent.ids.push(it.id);
  }
  fs.writeFileSync('content/.notified.json', JSON.stringify(sent, null, 2));
})();
