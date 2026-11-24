// Guarda el número de suscriptores de Buttondown en content/stats.json.
// La página lee ese archivo desde tu propio dominio, así que el contador
// se ve siempre (sin depender de Netlify ni de permisos CORS).
// Lo ejecuta la GitHub Action "Actualizar seguidores" cada pocas horas.
const fs = require('fs');

const KEY = process.env.BUTTONDOWN_API_KEY;
const ARCHIVO = 'content/stats.json';

(async () => {
  if (!KEY) { console.log('Falta el secret BUTTONDOWN_API_KEY; no hago nada.'); return; }

  const res = await fetch('https://api.buttondown.com/v1/subscribers?type=regular', {
    headers: { Authorization: `Token ${KEY}` }
  });
  if (!res.ok) { console.error('Buttondown respondió', res.status, await res.text()); process.exit(1); }
  const data = await res.json();
  const n = typeof data.count === 'number' ? data.count : (data.results || []).length;

  let previo = {};
  try { previo = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); } catch (e) {}

  if (previo.seguidores === n) { console.log(`Sin cambios: ${n} seguidores.`); return; }

  fs.writeFileSync(ARCHIVO, JSON.stringify({ seguidores: n, actualizado: new Date().toISOString() }, null, 2) + '\n');
  console.log(`Actualizado: ${previo.seguidores ?? '—'} → ${n} seguidores.`);
})().catch(e => { console.error(e); process.exit(1); });
