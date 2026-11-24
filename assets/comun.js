/* =====================================================================
   Código compartido por todas las páginas (portada, notas y mapas).
   ===================================================================== */

// URL de la función de Netlify (respaldo en vivo del contador).
const FUNCION_SEGUIDORES = 'https://profound-taiyaki-99994f.netlify.app/.netlify/functions/subscriber-count';

const DEFAULT_STATE = {
  profile:{ name:"Christopher Soule", eyebrow:"Autor de Fantasía",
    tagline:"«Soy un escritor de polvo de estrellas; de historias antiguas y olvidadas por el pasar de los siglos.»",
    location:"México", since:"2021", extra:"", avatar:"" },
  bio:[], stats:{ obras:"00", listas:"0", seguidores:"0" },
  works:[], reading:[], readers:[], blog:[], progress:[], sagas:[],
  credo:"Mi viaje aún continúa."
};

/* ---------- utilidades de texto ---------- */
function initials(name){
  return (name||"").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase() || "CS";
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Para enlaces externos (Amazon, etc.): solo acepta http/https.
function escapeAttr(s){
  const v = String(s||"").trim();
  if (!/^https?:\/\//i.test(v)) return '#';
  return v.replace(/"/g, '&quot;');
}
// Para rutas de imágenes (relativas como content/uploads/... o absolutas).
function safeSrc(s){
  const v = String(s||"").trim();
  if (!v || /^(javascript|data|vbscript):/i.test(v)) return '';
  return escapeHtml(v.replace(/^\//, ''));
}
function slugify(s){
  return String(s||"").toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
// Identificador estable de cada nota, usado en los enlaces (notas.html?n=...).
// El script de correos y el de redes sociales usan exactamente la misma fórmula.
function noteSlug(n){
  return slugify((n.date||'') + ' ' + slugify(n.title).slice(0,60));
}
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function formatDate(iso, conAnio = true){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}` + (conAnio ? ` ${d.getUTCFullYear()}` : '');
}
// Notas de la más nueva a la más vieja.
function notasOrdenadas(state){
  return (state.blog||[]).slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
}

/* ---------- carga del contenido ---------- */
function cargarSitio(){
  return fetch('content/site.json', { cache: 'no-store' })
    .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => DEFAULT_STATE);
}

/* ---------- contador de seguidores ----------
   1) Lee content/stats.json: está en tu mismo dominio, así que nunca hay
      bloqueo CORS. Lo actualiza solo la GitHub Action "Actualizar seguidores".
   2) Después intenta la función de Netlify para tener el número al minuto;
      si responde bien, reemplaza el número. Si falla, se queda el de (1). */
let _seguidoresPromesa = null;
function cargarSeguidores(onUpdate){
  if (!_seguidoresPromesa) {
    _seguidoresPromesa = fetch('content/stats.json', { cache:'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => (d && typeof d.seguidores === 'number') ? d.seguidores : null)
      .catch(() => null);
  }
  _seguidoresPromesa.then(n => { if (n !== null) onUpdate(n); });

  const ctrl = ('AbortController' in window) ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
  fetch(FUNCION_SEGUIDORES, ctrl ? { signal: ctrl.signal } : {})
    .then(r => r.json())
    .then(d => { if (typeof d.count === 'number') onUpdate(d.count); })
    .catch(() => {})
    .finally(() => t && clearTimeout(t));
}

/* ---------- elementos comunes ---------- */
function pintarAvatares(state, ids){
  const p = state.profile || {};
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    const src = safeSrc(p.avatar);
    el.innerHTML = src ? `<img src="${src}" alt="">` : `<span>${escapeHtml(initials(p.name))}</span>`;
  });
}

function iniciarChispas(){
  const container = document.getElementById('motes');
  if (!container) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for(let i=0;i<22;i++){
    const m = document.createElement('div'); m.className='mote';
    const size = 2 + Math.random()*3;
    m.style.width = size+'px'; m.style.height = size+'px';
    m.style.left = Math.random()*100+'vw';
    m.style.setProperty('--drift', (Math.random()*60-30)+'px');
    m.style.animationDuration = (10+Math.random()*14)+'s';
    m.style.animationDelay = (Math.random()*14)+'s';
    container.appendChild(m);
  }
}

function iniciarNav(){
  const nav = document.querySelector('nav.topnav');
  if (!nav) return;
  const f = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', f, { passive:true }); f();
}

let _toastTimer;
function toast(msg){
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Comparte un enlace con el menú nativo del teléfono, o lo copia.
function compartir(url, titulo){
  if (navigator.share) {
    navigator.share({ title: titulo, url }).catch(()=>{});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Enlace copiado'), () => prompt('Copia el enlace:', url));
  } else {
    prompt('Copia el enlace:', url);
  }
}

// Abre la ventanita de Buttondown al suscribirse (todas las páginas).
function iniciarFormulariosSuscripcion(){
  document.querySelectorAll('form[data-buttondown]').forEach(f=>{
    f.addEventListener('submit', () => window.open('https://buttondown.com/Christopher_Soule','popupwindow'));
  });
}
