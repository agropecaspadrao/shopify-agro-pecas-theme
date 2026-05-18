#!/usr/bin/env python3
"""
Gera posts de campanha em dois formatos:
  1. util/Posts/app_posts_campanha_v1.html  — base64 (preview local + captura PNG)
  2. sections/social-posts.liquid           — Liquid para Shopify (agropecaspadrao.com.br/pages/social-posts)

Uso:
  python3 gerar_posts_campanha.py
  node capturar_posts.mjs --file app_posts_campanha_v1.html --out posts_campanha_v1
"""

import base64, pathlib, sys

HERE     = pathlib.Path(__file__).parent
ASSETS   = HERE.parent.parent / "assets"
OUT_HTML = HERE / "app_posts_campanha_v1.html"
OUT_LIQ  = HERE.parent.parent / "sections" / "social-posts.liquid"
WA       = "5541984151085"
SITE     = "agropecaspadrao.com.br"

LOGO_BRANCA = "logo_app_branca.png"           # Stories: exibido no CORPO (logo branca transparente)
LOGO_ICON   = "APP - LOGO - COM FUNDO V3.png" # Todos os outros slides: header / badge area

_RENDER = "b64"  # "b64" | "lq"


# ── image helpers ──────────────────────────────────────────────────────────────

def _b64(name):
    p = ASSETS / name
    if not p.exists():
        print(f"  ⚠  não encontrada: {name}", file=sys.stderr)
        return ""
    ext = p.suffix.lower().lstrip(".")
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "svg": "svg+xml"}.get(ext, "png")
    return f"data:image/{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def img(name, alt="", cls="", style=""):
    attrs = f'alt="{alt}"'
    if cls:   attrs += f' class="{cls}"'
    if style: attrs += f' style="{style}"'

    if _RENDER == "lq":
        if not (ASSETS / name).exists():
            return f'<div class="img-miss">{alt}</div>'
        # Python f-string: {{ → {  }} → }  so {{{{ → {{ and }}}} → }}
        return f"<img src=\"{{{{ '{name}' | asset_url }}}}\" {attrs}>"

    src = _b64(name)
    if not src:
        return (f'<div style="background:#ddd;width:100%;height:100%;'
                f'display:flex;align-items:center;justify-content:center;'
                f'font-size:.55rem;color:#999">{alt}</div>')
    return f'<img src="{src}" {attrs}>'


WA_SVG = ('<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967'
          '-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075'
          '-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458'
          '.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52'
          '-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01'
          '-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074'
          '.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118'
          '.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347'
          'm-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374'
          'a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898'
          'a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815'
          ' 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654'
          'a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"'
          '/></svg>')


# ── product data ──────────────────────────────────────────────────────────────
# (img_file, sku, display_name, series_line)

VALTRA = [
    ("livenza_5.0220.0547201-CT_REV._0_p1.png", "5.0220.0547201", "Bomba Hidráulica Principal",  "Séries 885 · 985 · 1280 · 1480"),
    ("livenza_5.0220.0547205-CT_REV._0_p1.png", "5.0220.0547205", "Bomba Hidráulica Principal",  "Séries 880 · 980 · 1780"),
    ("livenza_5.0220.0547206-CT_REV._0_p1.png", "5.0220.0547206", "Bomba Hidráulica Principal",  "Séries 118ES · 128 · 138 · 148"),
    ("livenza_5.0220.0547202-CT_REV._0_p1.png", "5.0220.0547202", "Bomba Hidráulica Principal",  "Séries 62 · 65 · 68 · 85 · 86 · 88 · 78EL"),
]

NH = [
    ("livenza_5.1301.0565008_p1.png",            "5.1301.0565008", "Bomba Hidráulica",            "Séries TB · TS (CNH A-008)"),
    ("livenza_5.1301.0565017_p1.png",            "5.1301.0565017", "Bomba Hidráulica",            "Série TS6000 (CNH A-017)"),
    ("livenza_5.1301.0565002-CT_REV._0_p1.png",  "5.1301.0565002", "Bomba Hidráulica Principal",  "Séries 5610 · 7610 · 7810"),
    ("livenza_5.1301.0565035_p1.png",            "5.1301.0565035", "Bomba Hidráulica",            "Série T6 — T6110 · T6140"),
    ("livenza_5.1301.0565001-CT_REV._0_p1.png",  "5.1301.0565001", "Bomba Hidráulica",            "Séries 5600 · 6600 · 7600 · 7700 · 8030"),
    ("livenza_5.1301.0565004-CT_REV._A_p1.png",  "5.1301.0565004", "Bomba Hidráulica",            "Séries 340 · 2910 · 3930 · 4630"),
]

MF = [
    ("livenza_5.1302.0547844-CT_REV._A_p1.png",  "5.1302.0547844",   "Bomba Hidráulica",           "Séries 4215 · 4220 · 4235 · 4255"),
    ("livenza_5.1302.0565053-1_p1.png",           "5.1302.0565053",   "Bomba Hidráulica",           "Trator 4299"),
    ("livenza_5.1302.0547820-CT_REV._0_p1.png",  "5.1302.0547820",   "Bomba — Direção e Levante",  "Séries 3050 · 6110 · 6120 · 6190"),
    ("livenza_5.0220.0548836-CT_REV._0_p1.png",  "5.0220.0548836",   "Bomba de Direção",           "Séries 194-4F · 362 · 365 · 372 · 390"),
    ("livenza_5.0220.0547216-CT_REV._0_p1.png",  "5.0220.0547216",   "Bomba Hidráulica Principal", "Séries 296-4 · 297-4 · 299-4"),
    ("livenza_5.0220.0548824-2_p1.png",           "5.0220.0548824-2", "Bomba Hidráulica Dupla",     "BH160 — Engrenagem Dupla"),
]

JD = [
    ("livenza_5.1305.0565036_p1.png", "5.1305.0565036", "Bomba Hidráulica Principal", "Séries 6010 · 6110 · 6220 · 6420 · 6620"),
    ("livenza_5.1305.0565071_p1.png", "5.1305.0565071", "Bomba — Direção e Levante",  "Séries 5210 · 5310 · 5420 · 5520 · 6000"),
    ("livenza_5.1305.0565032_p1.png", "5.0209.0547219", "Bomba Hidráulica",           "Colhedeiras 1150 · 1165 · 7300 · 7500 · 8500"),
]

AGCO = [
    ("agco_ACX3454710_ecommerce_1.png", "ACX3454710",   "Reservatório de Sementes Mecânico", "Plantadeira Momentum — Sistema de Dosagem"),
    ("agco_ACX3266690_ecommerce_1.png", "ACX3266690",   "Suporte do Dosador",                "Plantadeira Momentum Pneumática"),
    ("agco_33070004_ecommerce.png",     "33070004",     "Condutor Reto de Sementes",          "Plantadeira Momentum — Linha de Condução"),
    ("agco_ACW0551840_ecommerce_1.png", "ACW0551840",   "Condutor de Sementes para Sensor",   "Plantadeira Momentum — Compatível PM400/SRM"),
    ("agco_7038105M1_ecommerce.png",    "7038105M1",    "Acoplamento do Condutor",            "Plantadeira Momentum — Condutor de Sementes"),
    ("agco_7038106M1_ecommerce.png",    "7038106M1",    "Acoplamento da Curva",               "Plantadeira Momentum — Condutor de Sementes"),
    ("agco_ACX3371800_ecommerce.png",   "ACX3371800",   "Bocal Cotovelo de Vácuo",            "Plantadeira Momentum — Sistema Pneumático"),
    ("agco_ACX2414460_ecommerce.png",   "ACX2414460",   "Conjunto Adaptador de Vácuo",        "Plantadeira Momentum Pneumática"),
    ("agco_ACX363311B_ecommerce.png",   "ACX363311B",   "Copo Venturi B",                     "Dosador Pneumático — Plantadeira Momentum"),
    ("agco_ACX363311C_ecommerce.png",   "ACX363311C",   "Copo Venturi C",                     "Dosador Pneumático — Plantadeira Momentum"),
    ("agco_ACX5458940_ecommerce.png",   "ACX5458940",   "Proteção SRM",                       "Monitor de Linhas — Plantadeira Momentum"),
    ("agco_ACX329796A_ecommerce.png",   "ACX329796A",   "Defletor do Radiador",               "Sistema de Arrefecimento — Trator"),
]

GRECO = [
    ("greco_GR141207_ecommerce.png",     "GR141207",      "GPS Agrícola GR200",             "Navegação de Precisão — Barra de Luz"),
    ("greco_GR142398_ecommerce.png",     "GR142398",      "Monitor de Sementes GR500",      "Kit Completo — Plantadeira de Precisão"),
    ("greco_GR142226_ecommerce.png",     "GR142226",      "Sensor de Fluxo 25,4mm",         "Compatível Precision Planting PM400"),
    ("greco_GR142227_ecommerce.png",     "GR142227",      "Sensor de Fluxo 32mm",           "Compatível Precision Planting PM400"),
    ("greco_GR140682_ecommerce.png",     "GR140682",      "Sensor de Levante — Haste",      "Compatível Precision Planting PM400"),
    ("greco_GR140012_ecommerce.png",     "GR140012",      "Sensor de Levante — Corrente",   "Compatível Precision Planting PM400"),
    ("greco_GR141165_ecommerce.png",     "GR141165",      "Kit Iluminação Noturna",         "Pulverização — Visibilidade Noturna"),
    ("greco_GR140990-30M_ecommerce.png", "GR140990-30M",  "Kit Ponta de Cerca — 30 Metros", "Divisa de Lavoura e Pastagem"),
]

AGRAL = [
    ("sensor_SFLX2_ecommerce.png",      "SFLX2", "Sensor de Fluxo SFLX2",   "Plantadeira de Precisão — Monitor Dickey-John"),
    ("sensor_PUL2_agral_ecommerce.png", "PUL-2", "Sensor de Semente PUL-2", "Plantadeira de Precisão — Monitor Dickey-John"),
]


# ── background gradients ───────────────────────────────────────────────────────

BG_V   = "background:linear-gradient(175deg,#071510 0%,#1B4332 100%)"
BG_NH  = "background:linear-gradient(165deg,#0A1A10 0%,#2A5540 100%)"
BG_MF  = "background:linear-gradient(175deg,#0D1A15 0%,#1e4a36 100%)"
BG_JD  = "background:linear-gradient(170deg,#0B1A0F 0%,#173629 100%)"
BG_AGC = "background:linear-gradient(175deg,#0B1820 0%,#1a3040 100%)"
BG_GRC = "background:linear-gradient(175deg,#0D1B2A 0%,#1D3557 100%)"
BG_SEN = "background:linear-gradient(175deg,#0D1B2A 0%,#1a2d4a 100%)"


# ── CSS ───────────────────────────────────────────────────────────────────────

CSS = """
:root{--verde:#1B4332;--azul:#1D3557;--dourado:#D4AF37;--carvao:#2F2F2F;
  --areia:#E6E1D9;--whatsapp:#25D366}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Barlow',sans-serif;background:#111;color:#fff}
.wrap{padding:2rem 1.5rem 4rem;display:flex;flex-direction:column;align-items:center;gap:2.5rem}
.tb{position:sticky;top:0;z-index:100;background:rgba(10,10,10,.95);backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(212,175,55,.2);padding:.8rem 1.5rem;display:flex;
  align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem}
.tb-t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:1rem;
  color:var(--dourado);letter-spacing:2px;text-transform:uppercase}
.tb-nav{display:flex;gap:.4rem;flex-wrap:wrap}
.tb-b{font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:.7rem;
  letter-spacing:1px;text-transform:uppercase;padding:.4rem .8rem;
  border:1px solid rgba(255,255,255,.12);background:transparent;
  color:rgba(255,255,255,.5);cursor:pointer;transition:.25s;border-radius:4px}
.tb-b:hover,.tb-b.on{background:var(--dourado);color:#0a0a0a;border-color:var(--dourado)}
.tb-i{font-size:.65rem;color:rgba(255,255,255,.3);width:100%;text-align:center}
.grp{display:none;flex-direction:column;align-items:center;gap:2rem}
.grp.on{display:flex}
.lbl{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.7rem;
  letter-spacing:3px;text-transform:uppercase;color:var(--dourado);
  padding:.35rem 1rem;border:1px solid rgba(212,175,55,.25);border-radius:4px}
/* frames */
.f{position:relative;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,.5);
  flex-shrink:0;border-radius:12px}
.f.sq{width:540px;height:540px}
.f.pt{width:540px;height:675px}
.f.st{width:405px;height:720px}
/* gold lines */
.gl-t,.gl-b{position:absolute;left:0;right:0;height:3px;
  background:linear-gradient(90deg,transparent 8%,var(--dourado) 50%,transparent 92%);z-index:5}
.gl-t{top:0}.gl-b{bottom:0}
.gl-s{position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--dourado);z-index:5}
/* ── HERO ── */
.s-hero{width:100%;height:100%;
  background:linear-gradient(160deg,var(--verde) 0%,#0F2B1E 40%,var(--azul) 100%);
  display:flex;flex-direction:column;justify-content:center;align-items:center;
  text-align:center;padding:2.5rem;position:relative}
.s-hero::before{content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse 120% 60% at 30% 80%,rgba(212,175,55,.07) 0%,transparent 60%),
  repeating-linear-gradient(45deg,transparent,transparent 40px,rgba(212,175,55,.015) 40px,rgba(212,175,55,.015) 41px)}
.hz{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center}
.badge-hero{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-weight:700;
  font-size:.58rem;letter-spacing:4px;text-transform:uppercase;color:var(--dourado);
  border:1.5px solid var(--dourado);padding:.3rem 1.1rem;margin-bottom:1.4rem;border-radius:3px}
.hero-logo{width:260px;max-width:75%;margin-bottom:1.6rem;
  filter:drop-shadow(0 4px 16px rgba(0,0,0,.35))}
.hero-h{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.45rem;
  color:#fff;line-height:1.3;margin-bottom:.65rem;text-transform:uppercase}
.hero-h em{color:var(--dourado);font-style:normal}
.hero-p{font-weight:400;font-size:.76rem;color:rgba(255,255,255,.6);
  line-height:1.6;max-width:360px;margin:0 auto 1.6rem}
.hero-cta{display:inline-flex;align-items:center;gap:.45rem;background:var(--whatsapp);
  color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.78rem;
  letter-spacing:1.5px;text-transform:uppercase;padding:.58rem 1.4rem;border-radius:6px}
.hero-cta svg{width:16px;height:16px;fill:currentColor}
.hero-url{margin-top:.9rem;font-size:.6rem;color:rgba(255,255,255,.3);letter-spacing:1.5px}
/* ── SINGLE SLIDE (portrait + square) ── */
.s-feat{width:100%;height:100%;display:flex;flex-direction:column;position:relative}
.feat-hd{padding:.85rem 1.2rem;display:flex;align-items:center;
  justify-content:space-between;position:relative;z-index:2}
.feat-badge{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.48rem;
  letter-spacing:3px;text-transform:uppercase;color:var(--dourado);
  border:1px solid rgba(212,175,55,.4);padding:.2rem .6rem;border-radius:3px}
.feat-logo{height:26px;width:auto;filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))}
.feat-img{flex:1;display:flex;align-items:center;justify-content:center;
  position:relative;min-height:0;padding:.8rem}
.feat-img::before{content:'';position:absolute;width:378px;height:378px;
  border:1.5px solid rgba(212,175,55,.08);border-radius:50%}
.feat-img img{width:294px;height:294px;object-fit:contain;position:relative;z-index:2;
  background:#fff;border-radius:50%;padding:31px;
  border:2px solid rgba(212,175,55,.15);
  filter:drop-shadow(0 8px 24px rgba(0,0,0,.4))}
.feat-body{padding:.75rem 1.2rem 1.1rem;position:relative;z-index:2}
.feat-sku{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.54rem;
  color:var(--dourado);letter-spacing:3px;margin-bottom:.25rem}
.feat-nm{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.05rem;
  color:#fff;line-height:1.2;margin-bottom:.25rem;text-transform:uppercase}
.feat-ser{font-weight:400;font-size:.64rem;color:rgba(255,255,255,.45);
  line-height:1.5;margin-bottom:.75rem}
.feat-cta{display:inline-flex;align-items:center;gap:.4rem;background:var(--whatsapp);
  color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.64rem;
  letter-spacing:1.5px;text-transform:uppercase;padding:.4rem 1rem;border-radius:6px}
.feat-cta svg{width:13px;height:13px;fill:currentColor}
/* ── CTA ── */
.s-cta{width:100%;height:100%;
  background:linear-gradient(160deg,var(--azul) 0%,#0D1B2A 60%,var(--verde) 100%);
  display:flex;flex-direction:column;justify-content:center;align-items:center;
  text-align:center;padding:2.5rem;position:relative}
.s-cta::before{content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(45deg,transparent,transparent 40px,
  rgba(212,175,55,.015) 40px,rgba(212,175,55,.015) 41px)}
.cz{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center}
.cta-icon{width:50px;height:50px;border:2px solid var(--dourado);border-radius:50%;
  display:flex;align-items:center;justify-content:center;margin:0 auto 1.1rem}
.cta-icon svg{width:22px;height:22px;fill:var(--dourado)}
.cta-h{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.45rem;
  color:#fff;line-height:1.15;margin-bottom:.65rem;text-transform:uppercase}
.cta-h em{color:var(--dourado);font-style:normal}
.cta-p{font-weight:400;font-size:.78rem;color:rgba(255,255,255,.55);
  line-height:1.6;margin-bottom:1.6rem;max-width:340px}
.cta-btn{display:inline-flex;align-items:center;gap:.45rem;background:var(--whatsapp);
  color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.82rem;
  letter-spacing:1.5px;text-transform:uppercase;padding:.65rem 1.7rem;
  margin-bottom:1.1rem;border-radius:6px}
.cta-btn svg{width:17px;height:17px;fill:currentColor}
.cta-meta{display:flex;flex-direction:column;gap:.22rem;font-size:.62rem;color:rgba(255,255,255,.32)}
.cta-meta .g{color:var(--dourado)}
.cta-logo{margin-top:1.6rem;height:42px;width:auto;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4))}
/* ── STORY ── */
.s-story{width:100%;height:100%;display:flex;flex-direction:column;position:relative}
/* Story header: só badge de categoria (sem logo) */
.st-top{padding:.85rem 1.4rem;position:relative;z-index:2}
.st-badge-h{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.44rem;
  letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,.38)}
/* Story image: produto em círculo — área central */
.st-img{flex:1;display:flex;align-items:center;justify-content:center;
  padding:1rem;min-height:0}
.st-img img{width:280px;height:280px;object-fit:contain;background:#fff;
  border-radius:50%;padding:31px;border:2px solid rgba(212,175,55,.2);
  filter:drop-shadow(0 6px 20px rgba(0,0,0,.45))}
/* Story 47 — logo hero (sem fundo branco circular) */
.st-img-logo{flex:1;display:flex;align-items:center;justify-content:center;
  padding:2rem;min-height:0}
.st-logo-hero{max-width:300px;width:85%;height:auto;
  filter:drop-shadow(0 4px 20px rgba(0,0,0,.5))}
/* Story body: logo branca no corpo + badge + título + desc + cta */
.st-body{padding:1rem 1.4rem 1.2rem;position:relative;z-index:2}
.st-logo-body{height:24px;width:auto;display:block;margin-bottom:.7rem;
  filter:drop-shadow(0 1px 4px rgba(0,0,0,.4))}
.st-badge{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.44rem;
  letter-spacing:4px;text-transform:uppercase;color:var(--dourado);
  border:1px solid rgba(212,175,55,.3);padding:.18rem .62rem;border-radius:3px;
  display:inline-block;margin-bottom:.6rem}
.st-h{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:1.2rem;
  color:#fff;line-height:1.2;margin-bottom:.38rem;text-transform:uppercase}
.st-h em{color:var(--dourado);font-style:normal}
.st-p{font-size:.68rem;color:rgba(255,255,255,.5);line-height:1.5;margin-bottom:.85rem}
.st-cta{display:inline-flex;align-items:center;gap:.38rem;background:var(--whatsapp);
  color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.68rem;
  letter-spacing:1.5px;text-transform:uppercase;padding:.45rem 1.05rem;border-radius:6px}
.st-cta svg{width:13px;height:13px;fill:currentColor}
.st-url{margin-top:.55rem;font-size:.54rem;color:rgba(255,255,255,.28);letter-spacing:1.5px}
@media(max-width:600px){
  .f.sq{width:340px;height:340px}.f.pt{width:340px;height:425px}
  .f.st{width:256px;height:455px}}
"""

JS = """
function sw(g,b){
  document.querySelectorAll('.grp').forEach(e=>e.classList.remove('on'));
  document.getElementById('g-'+g)?.classList.add('on');
  document.querySelectorAll('.tb-b').forEach(e=>e.classList.remove('on'));
  b.classList.add('on');
}
"""

LQ_SCHEMA = """
{% schema %}
{
  "name": "Social Posts",
  "settings": []
}
{% endschema %}
"""


# ── slide builders ────────────────────────────────────────────────────────────

def single_slide(img_name, sku, name, series, bg_css, badge, cta="Consultar disponibilidade"):
    """1 produto, imagem em círculo — usado para todos os posts portrait e carousel."""
    return f"""<div class="s-feat" style="{bg_css}">
    <div class="gl-t"></div>
    <div class="feat-hd">
      <div class="feat-badge">{badge}</div>
      {img(LOGO_ICON, 'APP', 'feat-logo')}
    </div>
    <div class="feat-img">{img(img_name, name)}</div>
    <div class="feat-body">
      <div class="feat-sku">{sku}</div>
      <div class="feat-nm">{name}</div>
      <div class="feat-ser">{series}</div>
      <div class="feat-cta">{WA_SVG} {cta}</div>
    </div>
    <div class="gl-s"></div>
  </div>"""


def story_slide(bg_css, badge, img_name, title, desc, cta="Solicitar catálogo", img_mode="product"):
    """Story: logo branca no CORPO (não no header). Header só tem texto de categoria.
    img_mode='logo' — exibe a imagem como logotipo grande, sem fundo branco circular.
    img_mode='product' (padrão) — imagem em círculo branco.
    """
    if img_mode == "logo":
        img_area = f'<div class="st-img-logo">{img(img_name, title, "st-logo-hero")}</div>'
    else:
        img_area = f'<div class="st-img">{img(img_name, title)}</div>'
    return f"""<div class="s-story" style="{bg_css}">
    <div class="gl-t"></div>
    <div class="st-top"><div class="st-badge-h">{badge}</div></div>
    {img_area}
    <div class="st-body">
      {img(LOGO_ICON, 'APP Agro Peças', 'st-logo-body')}
      <div class="st-badge">{badge}</div>
      <div class="st-h">{title}</div>
      <div class="st-p">{desc}</div>
      <div class="st-cta">{WA_SVG} {cta}</div>
      <div class="st-url">{SITE}</div>
    </div>
    <div class="gl-s"></div>
  </div>"""


def cta_slide():
    return f"""<div class="s-cta">
  <div class="gl-t"></div><div class="gl-b"></div>
  <div class="cz">
    <div class="cta-icon">{WA_SVG}</div>
    <div class="cta-h">Solicite cotação.<br><em>Resposta em minutos.</em></div>
    <div class="cta-p">Bombas hidráulicas com padrão original, peças com Padrão Original - OEM e tecnologia de precisão. Entrega para todo o Brasil.</div>
    <div class="cta-btn">{WA_SVG} Falar com Especialista</div>
    <div class="cta-meta">
      <span>Frete nacional · Suporte técnico</span>
      <span class="g">Padrão Original · Padrão OEM</span>
      <span>ISO 9001 · 14001 · OHSAS 18001</span>
    </div>
    {img(LOGO_ICON, 'APP', 'cta-logo')}
  </div>
</div>"""


def hero_slide():
    return f"""<div class="s-hero">
  <div class="gl-t"></div><div class="gl-b"></div>
  <div class="hz">
    <div class="badge-hero">Lançamento Oficial · 2026</div>
    {img(LOGO_ICON, 'APP', 'hero-logo')}
    <div class="hero-h">As peças que você precisa,<br><em>no padrão</em><br>que você merece.</div>
    <div class="hero-p">Bombas hidráulicas, peças plásticas com padrão original OEM e tecnologia de precisão — com entrega para todo o Brasil.</div>
    <div class="hero-cta">{WA_SVG} Solicitar Catálogo</div>
    <div class="hero-url">{SITE}</div>
  </div>
</div>"""


# ── post list builder ─────────────────────────────────────────────────────────

def _posts(group, products, badge, bg, size="pt", n0=1):
    result = []
    for i, prod in enumerate(products):
        img_name, sku, name, series = prod
        lbl = f"Post {n0+i:02d} — {sku}"
        result.append((
            group, lbl, size,
            (lambda i=img_name, s=sku, nm=name, se=series, b=bg, ba=badge:
             single_slide(i, s, nm, se, b, ba))
        ))
    return result


_BADGE_B = "Bomba Hidráulica · Padrão Original"
_BADGE_P = "Peças com Padrão Original - OEM"
_BADGE_G = "Tecnologia de Precisão · Greco Agro Tech"
_BADGE_S = "Sensor Agrícola · Agral"

# ── SLIDES_DEF: (group, label, size, builder_lambda) ──────────────────────────

SLIDES_DEF = (

  # ── CARROSSEL (5 slides sq) ───────────────────────────────────────────────
  [("carousel", "Slide 01 — Capa Lançamento", "sq", hero_slide),
   ("carousel", "Slide 02 — Bomba Hidráulica", "sq",
    lambda: single_slide(*VALTRA[0], BG_V,   _BADGE_B, "Ver catálogo")),
   ("carousel", "Slide 03 — Peça Padrão OEM",  "sq",
    lambda: single_slide(*AGCO[0],   BG_AGC, _BADGE_P, "Ver catálogo")),
   ("carousel", "Slide 04 — Tecnologia GPS",   "sq",
    lambda: single_slide(*GRECO[0],  BG_GRC, _BADGE_G, "Ver produtos")),
   ("carousel", "Slide 05 — CTA", "sq", cta_slide)]

  # ── BOMBAS (19 posts pt) ──────────────────────────────────────────────────
  + _posts("bombas", VALTRA, _BADGE_B, BG_V,  n0=6)
  + _posts("bombas", NH,     _BADGE_B, BG_NH, n0=10)
  + _posts("bombas", MF,     _BADGE_B, BG_MF, n0=16)
  + _posts("bombas", JD,     _BADGE_B, BG_JD, n0=22)

  # ── PEÇAS (12 posts pt) ───────────────────────────────────────────────────
  + _posts("pecas",    AGCO,  _BADGE_P, BG_AGC, n0=25)

  # ── GRECO (8 posts pt) ────────────────────────────────────────────────────
  + _posts("greco",    GRECO, _BADGE_G, BG_GRC, n0=37)

  # ── SENSORES (2 posts pt) ─────────────────────────────────────────────────
  + _posts("sensores", AGRAL, _BADGE_S, BG_SEN, n0=45)

  # ── STORIES (6 stories st) ────────────────────────────────────────────────
  + [
    ("stories", "Story 47 — Lançamento APP", "st",
     lambda: story_slide(
       "background:linear-gradient(160deg,var(--verde) 0%,#0F2B1E 50%,var(--azul) 100%)",
       "Lançamento Oficial · 2026",
       "APP - LOGO Quadrada SEM FUNDO.png",
       "Chegou o Padrão<br>para o Campo.<br><em>Chegou a APP.</em>",
       "Bombas Hidráulicas, Peças Plásticas padrão OEM e Agricultura de Precisão. Entrega nacional, suporte técnico.",
       "Solicitar catálogo",
       img_mode="product")),

    ("stories", "Story 48 — Bombas Hidráulicas", "st",
     lambda: story_slide(
       "background:linear-gradient(160deg,#0B1A0F 0%,#1B4332 100%)",
       "Bombas Hidráulicas · Padrão Original",
       "livenza_5.0220.0547201-CT_REV._0_p1.png",
       "Sua bomba<br>no <em>padrão</em><br>de fábrica.",
       "Para tratores das séries 885, 985, 880 e 980. ISO 9001 — mesma especificação do equipamento novo.",
       "Ver disponibilidade")),

    ("stories", "Story 49 — Peças Padrão OEM", "st",
     lambda: story_slide(
       "background:linear-gradient(160deg,var(--azul) 0%,#0D1B2A 60%,#1a3040 100%)",
       "Peças com Padrão Original - OEM",
       "agco_ACX3454710_ecommerce_1.png",
       "Sua plantadeira<br>no <em>padrão</em><br>de fábrica.",
       "Condutores, dosadores, acoplamentos e mais — com padrão OEM. Compatível com as principais plantadeiras do mercado.",
       "Ver catálogo")),

    ("stories", "Story 50 — Greco Agro Tech", "st",
     lambda: story_slide(
       "background:linear-gradient(160deg,#0D1B2A 0%,#1D3557 100%)",
       "Tecnologia de Precisão · Greco Agro Tech",
       "greco_GR141207_ecommerce.png",
       "GPS, monitores<br>e <em>sensores</em><br>de precisão.",
       "Barra de luz GR200, monitor GR500 e sensores compatíveis com Precision Planting PM400.",
       "Ver disponibilidade")),

    ("stories", "Story 51 — Sensores Agral", "st",
     lambda: story_slide(
       "background:linear-gradient(175deg,#0D1B2A 0%,#1a2d4a 100%)",
       "Sensores Agrícolas · Agral",
       "sensor_SFLX2.jpg",
       "Sensores para<br><em>plantio</em><br>de precisão.",
       "Sensor de fluxo SFLX2 e sensor de semente PUL-2. Compatível com monitor Dickey-John e PM400.",
       "Ver disponibilidade")),

    ("stories", "Story 52 — CTA WhatsApp", "st",
     lambda: story_slide(
       "background:linear-gradient(160deg,var(--azul) 0%,#0D1B2A 60%,var(--verde) 100%)",
       "Atendimento Técnico · APP Agro Peças",
       "greco_GR141207_ecommerce.png",
       "Fale agora.<br><em>Resposta rápida.</em>",
       "Nossa equipe técnica está pronta. Bombas, peças OEM e sensores — tudo em estoque, entrega nacional.",
       "Chamar no WhatsApp")),
  ]
)


# ── group navigation ──────────────────────────────────────────────────────────

GROUPS = {
  "carousel": "Carrossel Feed",
  "bombas":   "Bombas Hidráulicas",
  "pecas":    "Peças Padrão OEM",
  "greco":    "Greco / Sensores",
  "sensores": "Sensores Agral",
  "stories":  "Stories",
}


# ── renderer ─────────────────────────────────────────────────────────────────

def build(mode: str) -> str:
    global _RENDER
    _RENDER = mode

    # Execute all lambdas with current mode
    slides = [(g, l, s, fn()) for g, l, s, fn in SLIDES_DEF]

    group_html = {k: "" for k in GROUPS}
    for gid, label, size, html in slides:
        group_html[gid] += f'\n  <div class="lbl">{label}</div>\n  <div class="f {size}">{html}</div>\n'

    nav = ""
    for gid, label in GROUPS.items():
        active = " on" if gid == "carousel" else ""
        nav += f'<button class="tb-b{active}" onclick="sw(\'{gid}\',this)">{label}</button>\n    '

    sections = ""
    for gid, label in GROUPS.items():
        display = " on" if gid == "carousel" else ""
        sections += f'\n<div class="grp{display}" id="g-{gid}">{group_html[gid]}</div>\n'

    toolbar = (f'<div class="tb">'
               f'<div class="tb-t">APP — Campanha v1 · {len(slides)} posts</div>'
               f'<div class="tb-nav">{nav}</div>'
               f'<div class="tb-i">Feed 1080×1080 · Portrait 1080×1350 · Stories 810×1440</div>'
               f'</div>')
    wrap    = f'<div class="wrap">{sections}</div>'
    script  = f'<script>{JS}</script>'

    if mode == "lq":
        fonts = ('<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed'
                 ':ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&family=Barlow'
                 ':wght@300;400;500;600;700&display=swap" rel="stylesheet">')
        return f"{fonts}\n<style>{CSS}</style>\n{toolbar}\n{wrap}\n{script}\n{LQ_SCHEMA}"

    # HTML mode
    return (f'<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1.0">'
            f'<title>APP Agro Peças — Campanha v1 — {len(slides)} posts</title>\n'
            f'<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed'
            f':ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&family=Barlow'
            f':wght@300;400;500;600;700&display=swap" rel="stylesheet">'
            f'<style>{CSS}</style>\n</head>\n<body>\n'
            f'{toolbar}\n{wrap}\n{script}\n</body>\n</html>')


# ── validate images ───────────────────────────────────────────────────────────

print("🔍 Verificando imagens...")
needed = set()
for products in [VALTRA, NH, MF, JD, AGCO, GRECO, AGRAL]:
    for (img_name, *_) in products:
        needed.add(img_name)
needed.update([LOGO_BRANCA, LOGO_ICON,
               "livenza_5.0220.0547201-CT_REV._0_p1.png",
               "agco_ACX3454710_ecommerce_1.png",
               "greco_GR141207_ecommerce.png",
               "sensor_SFLX2.jpg"])

ok, missing = 0, []
for n in sorted(needed):
    (ok := ok + 1) if (ASSETS / n).exists() else missing.append(n)
print(f"   ✅ {ok}/{ok+len(missing)} imagens encontradas")
for m in missing:
    print(f"   ❌ {m}")

# ── generate HTML (base64) ────────────────────────────────────────────────────

print("🔄 Gerando HTML (base64)...")
html = build("b64")
OUT_HTML.write_text(html, encoding="utf-8")
size_mb = OUT_HTML.stat().st_size / 1_048_576
n_slides = len(SLIDES_DEF)
print(f"   ✅ {OUT_HTML.name}  ({size_mb:.1f} MB, {n_slides} posts)")

# ── generate Liquid section ───────────────────────────────────────────────────

print("🔄 Gerando Liquid section...")
liq = build("lq")
OUT_LIQ.write_text(liq, encoding="utf-8")
size_kb = OUT_LIQ.stat().st_size / 1024
print(f"   ✅ {OUT_LIQ.name}  ({size_kb:.0f} KB)")

print(f"""
📋 Próximos passos para hospedar em Shopify:
   1. Faça commit e push → seção 'social-posts' é publicada automaticamente
   2. No Shopify Admin → Pages → criar página:
      Title: Social Posts   Handle: social-posts
      Template: page.social-posts
   3. Acesse: agropecaspadrao.com.br/pages/social-posts
   (Configurar redirect /social/post → /pages/social-posts em Admin → Navigation)

🖼️  Para capturar os PNGs:
   node capturar_posts.mjs --file app_posts_campanha_v1.html --out posts_campanha_v1

📂 Abrir preview:
   open {OUT_HTML}
""")
