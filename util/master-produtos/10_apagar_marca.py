#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""10 — Apaga a marca GRECO gravada nas peças das fotos herdadas do fornecedor.

Não é borrão: para cada região reconstrói a superfície real da peça
(polinômio ajustado ao gradiente do entorno + grão do próprio material) e
corrige o degrau de borda com uma membrana de Laplace.

Lê de assets/_retoque-marca/<original>.png e grava <original>__LIMPA.png.
Coordenadas em pixel na imagem original (1500² salvo onde indicado).

Uso:  python3 10_apagar_marca.py
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE / "retoque"))
from retocar import rect_mask, poly_mask, _ring, src_poly, apply_fill, sample_keep  # noqa: E402

DIR = BASE.parent.parent / "assets" / "_retoque-marca"


def grain_from(a, box, shape, mask, amt=1.0, seed=5):
    """Ruído/textura extraída de uma área limpa do próprio material."""
    x0, y0, x1, y1 = box
    src = a[y0:y1, x0:x1]
    base = np.asarray(Image.fromarray(src.clip(0, 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(2.5)), np.float32)
    res = (src - base) * amt
    gh, gw, _ = res.shape
    h, w = shape
    tile = np.tile(res, (h // gh + 2, w // gw + 2, 1))[:h, :w]
    rng = np.random.default_rng(seed)
    tile = np.roll(tile, (int(rng.integers(0, gh)), int(rng.integers(0, gw))), (0, 1))
    return np.where((mask > 0.02)[..., None], tile, 0)


# --------------------------------------------------------------- receitas
def r_140990_30M(im):
    a = np.asarray(im, np.float32); h, w = a.shape[:2]
    m = poly_mask((h, w), [[(901, 510), (966, 499), (972, 547), (905, 557)]], grow=2)
    ring = _ring(m, 3, 20) & sample_keep(a, lum=(32, 105), not_green=True)
    return apply_fill(im, m, src_poly(a, m, ring, 2), ring, noise=1.0)


def r_140990_20M(im):
    """Versão do CDN, 770x520 — mesmo adesivo, escala menor."""
    a = np.asarray(im, np.float32); h, w = a.shape[:2]
    m = poly_mask((h, w), [[(474, 134), (505, 129), (508, 158), (477, 163)]], grow=1)
    ring = _ring(m, 2, 12) & sample_keep(a, lum=(28, 110), not_green=True)
    return apply_fill(im, m, src_poly(a, m, ring, 2), ring, noise=0.8)


def r_142398(im):
    a = np.asarray(im, np.float32); h, w = a.shape[:2]
    m = rect_mask((h, w), [(606, 800, 796, 864)], grow=2)
    ring = _ring(m, 4, 26) & sample_keep(a, lum=(28, 120), not_green=True)
    return apply_fill(im, m, src_poly(a, m, ring, 2), ring, noise=1.3)


def r_140012(im):
    """Placa de inox: apaga emblema + GRECO + Agro Tech, mantém SENSOR LEVANTE.

    Máscara no nível do glifo (limiar + dilatação que engole o halo
    antialiasado, senão sobra fantasma) — preserva o escovado do inox ao redor.
    Depois o emblema colado no visor do sensor Omron."""
    a = np.asarray(im, np.float32); h, w = a.shape[:2]

    # 1) gravação da placa. zona termina em y=785: abaixo é SENSOR LEVANTE
    zona = np.zeros((h, w), bool)
    zona[686:785, 618:788] = True
    g = (a.mean(2) < 148) & zona
    g = np.asarray(Image.fromarray((g * 255).astype(np.uint8))
                   .filter(ImageFilter.MaxFilter(9))) > 127
    g &= zona
    m1 = np.asarray(Image.fromarray((g * 255).astype(np.uint8))
                    .filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255.0
    m1 = np.where(zona, m1, 0)
    ring1 = _ring(m1, 3, 18) & sample_keep(a, lum=(120, 225))
    out = apply_fill(im, m1, src_poly(a, m1, ring1, 2), ring1, noise=1.4)

    # 2) emblema no visor preto do Omron — vira visor apagado
    a2 = np.asarray(out, np.float32)
    m2 = rect_mask((h, w), [(1074, 740, 1200, 870)], grow=1)
    ring2 = _ring(m2, 2, 12) & sample_keep(a2, lum=(None, 62))
    return apply_fill(out, m2, src_poly(a2, m2, ring2, 1), ring2, noise=1.0)


def r_141207(im):
    """4 marcas: logo e GR200 na tela, GR200 no bezel, logo na moldura."""
    h, w = np.asarray(im).shape[:2]

    def passo(cur, boxes, grow, ring_in, ring_out, keep_kw, deg, noise=0.0):
        a = np.asarray(cur, np.float32)
        m = rect_mask((h, w), boxes, grow=grow)
        ring = _ring(m, ring_in, ring_out) & sample_keep(a, **keep_kw)
        return apply_fill(cur, m, src_poly(a, m, ring, deg), ring, noise=noise)

    # céu da tela: gradiente forte -> grau 3
    out = passo(im, [(496, 590, 612, 706)], 2, 4, 30, dict(lum=(55, 252)), 3, 0.9)
    out = passo(out, [(650, 596, 1010, 710)], 2, 4, 32, dict(lum=(55, 252)), 3, 0.9)
    # bezel superior e moldura inferior: preto chapado -> grau 1
    out = passo(out, [(744, 412, 904, 458)], 2, 3, 11, dict(lum=(None, 62)), 1, 0.8)
    out = passo(out, [(790, 1002, 946, 1064)], 2, 2, 10, dict(lum=(None, 48), not_green=True), 1, 0.8)
    return out


RECEITAS = {
    "greco_GR140990-30M_ecommerce.png": r_140990_30M,
    "greco_GR140990-20M_ecommerce__DO-CDN.png": r_140990_20M,
    "greco_GR142398_ecommerce.png": r_142398,
    "greco_GR140012_ecommerce.png": r_140012,
    "greco_GR141207_ecommerce.png": r_141207,
}
# mesmo bitmap: reaproveita o resultado
COPIAS = {"greco_GR140682_ecommerce.png": "greco_GR140012_ecommerce.png"}


def main():
    for nome, fn in RECEITAS.items():
        src = DIR / nome
        im = Image.open(src).convert("RGB")
        out = fn(im)
        dst = DIR / nome.replace(".png", "__LIMPA.png")
        out.save(dst)
        print(f"  ✔ {dst.name}")
    for nome, de in COPIAS.items():
        o = DIR / de.replace(".png", "__LIMPA.png")
        d = DIR / nome.replace(".png", "__LIMPA.png")
        d.write_bytes(o.read_bytes())
        print(f"  ✔ {d.name}  (cópia de {o.name})")


if __name__ == "__main__":
    main()
