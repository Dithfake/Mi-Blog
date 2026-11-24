// =====================================================================
//  Publica cada NOTA nueva en tus redes sociales.
//  Lo ejecuta la GitHub Action "Avisar a suscriptores" cuando guardas
//  content/site.json desde /admin. Tú no tienes que abrir ninguna red.
//
//  · X (Twitter): publica el título y el extracto de la nota.
//  · Instagram:   publica una imagen-tarjeta con el título y el extracto
//                 (Instagram no permite publicaciones solo de texto),
//                 con la nota completa como descripción.
//
//  Cada red se activa sola en cuanto pones sus "secrets" en GitHub
//  (ver LEEME.md). Si una red no está configurada, simplemente se omite.
//  Lo ya publicado queda anotado en content/.notified.json → "social".
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SITE = (process.env.SITE_URL || 'https://www.christophersoule.com').replace(/\/$/, '');
const REPO = process.env.GITHUB_REPOSITORY || 'Dithfake/Mi-Blog';
const RAMA = process.env.GITHUB_REF_NAME || 'main';
const REGISTRO = 'content/.notified.json';
const MAX_POR_CORRIDA = 3;      // por red, para no publicar en ráfaga
const DIAS_MAXIMOS = 30;        // notas más viejas que esto no se publican

const X = {
  key: process.env.X_API_KEY, secret: process.env.X_API_SECRET,
  token: process.env.X_ACCESS_TOKEN, tokenSecret: process.env.X_ACCESS_SECRET,
  conEnlace: /^(1|si|sí|true)$/i.test(process.env.X_INCLUIR_ENLACE || '')
};
const IG = { token: process.env.INSTAGRAM_ACCESS_TOKEN };
const xActivo = !!(X.key && X.secret && X.token && X.tokenSecret);
const igActivo = !!IG.token;

/* ---------- mismas fórmulas que la página (assets/comun.js) ---------- */
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const noteSlug = n => slugify((n.date || '') + ' ' + slugify(n.title).slice(0, 60));
const urlNota = n => `${SITE}/notas.html?n=${noteSlug(n)}`;
const espera = ms => new Promise(r => setTimeout(r, ms));

/* =====================================================================
   X (Twitter) — API v2, firma OAuth 1.0a
   ===================================================================== */
const pct = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function firmaOAuth(metodo, url, params, consumerSecret, tokenSecret){
  const base = Object.keys(params).sort().map(k => `${pct(k)}=${pct(params[k])}`).join('&');
  const cadena = [metodo.toUpperCase(), pct(url), pct(base)].join('&');
  const clave = `${pct(consumerSecret)}&${pct(tokenSecret || '')}`;
  return crypto.createHmac('sha1', clave).update(cadena).digest('base64');
}

function cabeceraOAuth(metodo, url){
  const o = {
    oauth_consumer_key: X.key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X.token,
    oauth_version: '1.0'
  };
  o.oauth_signature = firmaOAuth(metodo, url, o, X.secret, X.tokenSecret);
  return 'OAuth ' + Object.keys(o).sort().map(k => `${pct(k)}="${pct(o[k])}"`).join(', ');
}

// X cuenta casi todos los caracteres latinos como 1 y los emojis/CJK como 2.
function largoX(s){
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += (c <= 0x10FF || (c >= 0x2000 && c <= 0x200D) || (c >= 0x2010 && c <= 0x201F) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
  }
  return n;
}
function recortarX(s, max){
  if (largoX(s) <= max) return s;
  let out = '';
  for (const ch of s) { if (largoX(out + ch) > max - 1) break; out += ch; }
  return out.replace(/\s+\S*$/, '').trimEnd() + '…';
}

function textoParaX(n){
  const enlace = X.conEnlace ? urlNota(n) : '';
  const reservado = enlace ? 25 : 0;  // X cuenta todo enlace como 23 + saltos de línea
  const cuerpo = [n.title, n.excerpt].filter(Boolean).map(t => t.trim()).join('\n\n');
  return recortarX(cuerpo, 280 - reservado) + (enlace ? '\n\n' + enlace : '');
}

async function publicarEnX(n){
  const url = 'https://api.x.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: cabeceraOAuth('POST', url), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: textoParaX(n) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X respondió ${res.status}: ${JSON.stringify(data)}`);
  return `https://x.com/i/web/status/${data.data && data.data.id}`;
}

/* =====================================================================
   Instagram — tarjeta JPEG + API de Instagram (Instagram Login)
   ===================================================================== */
function buscarFuente(archivo){
  const raiz = path.join(process.cwd(), 'node_modules', '@expo-google-fonts');
  const pila = [raiz];
  while (pila.length) {
    const d = pila.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else if (e.name === archivo) return p;
    }
  }
  throw new Error('No encontré la fuente ' + archivo + ' (¿se instaló @expo-google-fonts?)');
}

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Parte un texto en renglones que quepan en "ancho" px, midiendo con la fuente real.
function renglones(font, texto, size, ancho, maxLineas, espaciado = 0){
  const medir = t => font.getAdvanceWidth(t, size) + espaciado * t.length;
  const palabras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
  const out = []; let linea = '';
  for (const p of palabras) {
    const prueba = linea ? linea + ' ' + p : p;
    if (medir(prueba) <= ancho || !linea) linea = prueba;
    else { out.push(linea); linea = p; }
  }
  if (linea) out.push(linea);
  if (out.length > maxLineas) {
    const cortadas = out.slice(0, maxLineas);
    let ult = cortadas[maxLineas - 1];
    while (ult && medir(ult + '…') > ancho) ult = ult.replace(/\s*\S+$/, '');
    cortadas[maxLineas - 1] = ult.replace(/[\s,.;:—-]+$/, '') + '…';
    return cortadas;
  }
  return out;
}

async function imagenComoDataURI(ruta, w, h){
  const sharp = require('sharp');
  const limpia = decodeURIComponent(String(ruta).replace(/^\//, ''));
  if (!fs.existsSync(limpia)) return null;
  const buf = await sharp(limpia).resize(w, h, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

async function crearTarjeta(n, perfil, salida){
  const opentype = require('opentype.js');
  const { Resvg } = require('@resvg/resvg-js');
  const sharp = require('sharp');

  const F = {
    cinzel: buscarFuente('Cinzel_700Bold.ttf'),
    cinzelReg: buscarFuente('Cinzel_400Regular.ttf'),
    garamond: buscarFuente('EBGaramond_400Regular.ttf'),
    garamondIt: buscarFuente('EBGaramond_400Regular_Italic.ttf')
  };
  const cargar = f => { const b = fs.readFileSync(f); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const fCinzel = cargar(F.cinzel);
  const fGaramond = cargar(F.garamond);

  const W = 1080, H = 1350, M = 96, ANCHO = W - M * 2;
  const foto = n.image ? await imagenComoDataURI(n.image, W, 600) : null;
  const avatar = perfil.avatar ? await imagenComoDataURI(perfil.avatar, 120, 120) : null;

  const fecha = (() => {
    const d = new Date(n.date); if (isNaN(d)) return '';
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${d.getUTCDate()} de ${meses[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  })();

  let y = foto ? 690 : 250;
  const tamTitulo = foto ? 56 : 68;
  const titulo = renglones(fCinzel, n.title, tamTitulo, ANCHO, foto ? 3 : 4);
  const altoTitulo = titulo.length * tamTitulo * 1.22;

  const tamTexto = foto ? 38 : 42, lhTexto = tamTexto * 1.48;
  const inicioTexto = y + 70 + altoTitulo + 40;
  const finTexto = H - 210;
  const maxLineas = Math.max(1, Math.floor((finTexto - inicioTexto) / lhTexto));
  const texto = renglones(fGaramond, n.excerpt, tamTexto, ANCHO, maxLineas);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e150d"/><stop offset="1" stop-color="#0d0805"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.75"><stop offset="0" stop-color="#b3401e" stop-opacity="0.38"/><stop offset="1" stop-color="#b3401e" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#130d08" stop-opacity="0"/><stop offset="1" stop-color="#130d08" stop-opacity="1"/></linearGradient>
    <linearGradient id="linea" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b3401e"/><stop offset="1" stop-color="#cda233"/></linearGradient>
    <clipPath id="circ"><circle cx="${M + 30}" cy="${H - 120}" r="30"/></clipPath>
  </defs>
  ${foto ? `<rect width="${W}" height="${H}" fill="#130d08"/>`
         : `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`}
  ${foto ? `<image x="0" y="0" width="${W}" height="600" href="${foto}" preserveAspectRatio="xMidYMid slice"/>
            <rect x="0" y="0" width="${W}" height="602" fill="url(#fade)"/>` : ''}
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="#cda233" stroke-opacity="0.28" stroke-width="2" rx="6"/>
  <rect x="${M}" y="${y}" width="90" height="5" rx="2.5" fill="url(#linea)"/>
  <text x="${M}" y="${y + 52}" font-family="Cinzel" font-weight="400" font-size="22" letter-spacing="4" fill="#cda233">NOTAS DEL ESCRITORIO${fecha ? '  ·  ' + esc(fecha.toUpperCase()) : ''}</text>
  ${titulo.map((l, i) => `<text x="${M}" y="${y + 70 + tamTitulo + i * tamTitulo * 1.22}" font-family="Cinzel" font-weight="700" font-size="${tamTitulo}" fill="#efe3cd">${esc(l)}</text>`).join('\n  ')}
  ${texto.map((l, i) => `<text x="${M}" y="${inicioTexto + tamTexto + i * lhTexto}" font-family="EB Garamond" font-size="${tamTexto}" fill="#c2b191">${esc(l)}</text>`).join('\n  ')}
  <line x1="${M}" y1="${H - 190}" x2="${W - M}" y2="${H - 190}" stroke="#cda233" stroke-opacity="0.22" stroke-width="2"/>
  ${avatar ? `<image x="${M}" y="${H - 150}" width="60" height="60" href="${avatar}" clip-path="url(#circ)"/>`
           : `<circle cx="${M + 30}" cy="${H - 120}" r="30" fill="#b3401e"/>`}
  <circle cx="${M + 30}" cy="${H - 120}" r="30" fill="none" stroke="#cda233" stroke-opacity="0.6" stroke-width="2"/>
  <text x="${M + 80}" y="${H - 128}" font-family="Cinzel" font-weight="700" font-size="28" fill="#efe3cd">${esc(perfil.name)}</text>
  <text x="${M + 80}" y="${H - 94}" font-family="EB Garamond" font-style="italic" font-size="26" fill="#8a7a60">${esc(perfil.eyebrow || '')}</text>
  <text x="${W - M}" y="${H - 110}" text-anchor="end" font-family="Cinzel" font-weight="400" font-size="24" letter-spacing="2" fill="#cda233">${esc(SITE.replace(/^https?:\/\/(www\.)?/, ''))}</text>
</svg>`;

  const png = new Resvg(svg, {
    font: { fontFiles: Object.values(F), loadSystemFonts: false, defaultFontFamily: 'EB Garamond' },
    fitTo: { mode: 'width', value: W }
  }).render().asPng();
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toFile(salida);
  return salida;
}

function textoParaInstagram(n){
  const partes = [n.title, n.excerpt, n.content].filter(t => t && t.trim()).map(t => t.trim());
  const pie = `\n\n— Más notas en ${SITE.replace(/^https?:\/\//, '')}/notas`;
  let t = partes.join('\n\n');
  if (t.length + pie.length > 2200) t = t.slice(0, 2200 - pie.length - 1).replace(/\s+\S*$/, '') + '…';
  return t + pie;
}

async function urlPublica(rutaRepo){
  // Primero intenta tu dominio (GitHub Pages); si aún no se publicó, usa raw.githubusercontent.
  const propia = `${SITE}/${rutaRepo}`;
  for (let i = 0; i < 18; i++) {           // hasta ~3 minutos
    const r = await fetch(propia, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) return propia;
    await espera(10000);
  }
  const raw = `https://raw.githubusercontent.com/${REPO}/${RAMA}/${rutaRepo}`;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(raw, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) return raw;
    await espera(5000);
  }
  throw new Error('La imagen no quedó pública a tiempo: ' + rutaRepo);
}

async function publicarEnInstagram(n, perfil){
  const rel = `content/social/${noteSlug(n)}.jpg`;
  await crearTarjeta(n, perfil, rel);
  // La tarjeta debe estar en internet para que Instagram la descargue.
  execSync(`git add "${rel}"`);
  try { execSync(`git commit -m "Tarjeta de Instagram: ${noteSlug(n)}"`); } catch (e) { /* ya estaba */ }
  execSync('git pull --rebase --autostash && git push', { stdio: 'inherit' });
  const imageUrl = await urlPublica(rel);

  const api = 'https://graph.instagram.com/v24.0';
  const auth = { Authorization: `Bearer ${IG.token}` };
  const yo = await fetch(`${api}/me?fields=user_id,username`, { headers: auth }).then(r => r.json());
  const igId = yo.user_id || yo.id;
  if (!igId) throw new Error('El token de Instagram no funciona: ' + JSON.stringify(yo.error || yo));

  const cont = await fetch(`${api}/${igId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IG.token}` },
    body: JSON.stringify({ image_url: imageUrl, caption: textoParaInstagram(n), alt_text: `${n.title}. ${n.excerpt || ''}`.slice(0, 1000) })
  }).then(r => r.json());
  if (!cont.id) throw new Error('Instagram no creó el contenedor: ' + JSON.stringify(cont.error || cont));

  for (let i = 0; i < 12; i++) {          // esperar a que Instagram procese la imagen
    const st = await fetch(`${api}/${cont.id}?fields=status_code`, { headers: auth }).then(r => r.json());
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram rechazó la imagen: ' + JSON.stringify(st));
    await espera(5000);
  }
  const pub = await fetch(`${api}/${igId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${IG.token}` },
    body: JSON.stringify({ creation_id: cont.id })
  }).then(r => r.json());
  if (!pub.id) throw new Error('Instagram no publicó: ' + JSON.stringify(pub.error || pub));
  return `publicación ${pub.id}`;
}

/* =====================================================================
   Principal
   ===================================================================== */
async function main(){
  const site = JSON.parse(fs.readFileSync('content/site.json', 'utf8'));
  let reg = { ids: [] };
  try { reg = JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch (e) {}
  const guardar = () => fs.writeFileSync(REGISTRO, JSON.stringify(reg, null, 2) + '\n');

  const notas = (site.blog || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Primera vez: anota las notas que ya existen para NO publicarlas de golpe.
  if (!Array.isArray(reg.social)) {
    reg.social = notas.flatMap(n => ['x:' + noteSlug(n), 'ig:' + noteSlug(n)]);
    guardar();
    console.log(`Primera ejecución: registré ${notas.length} notas existentes sin publicarlas.`);
    return;
  }

  const redes = [
    { id: 'x', nombre: 'X', activa: xActivo, publicar: n => publicarEnX(n) },
    { id: 'ig', nombre: 'Instagram', activa: igActivo, publicar: n => publicarEnInstagram(n, site.profile || {}) }
  ];
  const limite = Date.now() - DIAS_MAXIMOS * 86400e3;
  let errores = 0;

  for (const red of redes) {
    let hechas = 0;
    for (const n of notas) {
      const id = `${red.id}:${noteSlug(n)}`;
      if (reg.social.includes(id)) continue;
      const fecha = new Date(n.date).getTime();
      if (!red.activa || (fecha && fecha < limite)) {
        // red sin configurar o nota vieja: se anota para no publicarla después en ráfaga
        reg.social.push(id); guardar();
        console.log(`${red.nombre}: omitida "${n.title}" (${red.activa ? 'nota antigua' : 'red no configurada'}).`);
        continue;
      }
      if (hechas >= MAX_POR_CORRIDA) { console.log(`${red.nombre}: quedan notas pendientes para la próxima vez.`); break; }
      try {
        const donde = await red.publicar(n);
        reg.social.push(id); guardar(); hechas++;
        console.log(`${red.nombre}: publicada "${n.title}" → ${donde}`);
      } catch (e) {
        errores++;
        console.error(`::error::${red.nombre}: no se pudo publicar "${n.title}": ${e.message}`);
      }
    }
  }
  if (errores) process.exitCode = 1;   // se reintentará la próxima vez que guardes
}

module.exports = { firmaOAuth, textoParaX, largoX, crearTarjeta, textoParaInstagram, noteSlug };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
