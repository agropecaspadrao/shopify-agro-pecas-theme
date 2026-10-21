// Origem do lead, no formato combinado com o SDR comercial (app-agente-sdr):
//   { tipo: 'anuncio'|'catalogo'|'site'|'organico', plataforma: 'facebook'|'instagram',
//     source_type, source_id, source_url, headline, ctwa_clid, produto }
// Só os campos presentes vão no objeto. Plataforma: source_url com
// instagram.com → instagram; facebook.com/fb.me → facebook; anúncio sem URL →
// facebook (o click-to-WhatsApp sem link é do Facebook).

export function plataformaDe(url) {
  const u = String(url || '').toLowerCase();
  if (/(^|\.|\/\/)instagram\.com|instagr\.am/.test(u)) return 'instagram';
  if (/(^|\.|\/\/)(facebook\.com|fb\.me|fb\.com|m\.me)/.test(u)) return 'facebook';
  return u ? null : 'facebook';
}

/**
 * @param {{canal:'whatsapp'|'site', anuncio?:{titulo?:string,url?:string,sourceType?:string,sourceId?:string,ctwaClid?:string}|null, produtoCatalogo?:string|null}} p
 */
export function montarOrigem({ canal, anuncio, produtoCatalogo } = {}) {
  if (canal === 'site') return { tipo: 'site' };
  if (anuncio) {
    const o = { tipo: 'anuncio' };
    const plataforma = plataformaDe(anuncio.url);
    if (plataforma) o.plataforma = plataforma;
    if (anuncio.sourceType) o.source_type = anuncio.sourceType;
    if (anuncio.sourceId) o.source_id = anuncio.sourceId;
    if (anuncio.url) o.source_url = anuncio.url;
    if (anuncio.titulo) o.headline = anuncio.titulo;
    if (anuncio.ctwaClid) o.ctwa_clid = anuncio.ctwaClid;
    return o;
  }
  if (produtoCatalogo) return { tipo: 'catalogo', produto: String(produtoCatalogo) };
  return { tipo: 'organico' };
}
