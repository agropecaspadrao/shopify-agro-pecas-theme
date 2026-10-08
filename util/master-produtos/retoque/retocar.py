# -*- coding: utf-8 -*-
"""Retoque de imagem sem OpenCV — apagar marca gravada na peça.

Pipeline (o mesmo para todos os casos):
  1. máscara suave da região a apagar (polígono antialiasado);
  2. FONTE candidata para preencher, avaliada também fora da máscara:
       src_poly()  — superfície lisa: polinômio ajustado ao gradiente real;
       src_clone() — superfície com textura: pedaço limpo da própria peça;
  3. erro (original − fonte) medido num anel em volta;
  4. membrana de Laplace leva esse erro para dentro → some o degrau de borda;
  5. composição pela máscara suave.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersampling da máscara


# ---------------------------------------------------------------- máscaras
def poly_mask(shape, polys, grow=0.0):
    """Máscara suave (float 0..1) a partir de polígonos em coords de pixel."""
    h, w = shape
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    for pts in polys:
        d.polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    m = big.resize((w, h), Image.LANCZOS)
    if grow:
        m = m.filter(ImageFilter.MaxFilter(int(grow) * 2 + 1))
    return np.asarray(m, np.float32) / 255.0


def rect_mask(shape, boxes, grow=0.0):
    return poly_mask(shape, [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
                             for x0, y0, x1, y1 in boxes], grow)


def _hard(m):
    return m > 0.5


def _ring(m, inner=3, outer=22):
    a = (m > 0.02).astype(np.uint8) * 255
    gi = np.asarray(Image.fromarray(a).filter(ImageFilter.MaxFilter(inner * 2 + 1)))
    go = np.asarray(Image.fromarray(a).filter(ImageFilter.MaxFilter(outer * 2 + 1)))
    return (go > 127) & ~(gi > 127)


# ------------------------------------------------------------------ fontes
def src_poly(img, mask, ring, degree=2):
    """Polinômio ajustado aos pixels do anel, avaliado na imagem toda."""
    a = img
    ys, xs = np.where(ring)
    if len(ys) < 40:
        raise RuntimeError(f"anel pequeno demais ({len(ys)} px)")
    cx, cy, sx, sy = xs.mean(), ys.mean(), max(xs.std(), 1), max(ys.std(), 1)

    def terms(X, Y):
        X = (X - cx) / sx; Y = (Y - cy) / sy
        c = [np.ones_like(X), X, Y]
        if degree >= 2: c += [X * X, X * Y, Y * Y]
        if degree >= 3: c += [X ** 3, X * X * Y, X * Y * Y, Y ** 3]
        return np.stack(c, 1)

    H, W, _ = a.shape
    need = (mask > 0.02) | ring
    ny, nx = np.where(need)
    A = terms(xs.astype(np.float32), ys.astype(np.float32))
    B = terms(nx.astype(np.float32), ny.astype(np.float32))
    src = a.copy()
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, a[ys, xs, c], rcond=None)
        src[ny, nx, c] = B @ coef
    return src


def src_clone(img, dx, dy):
    """Fonte = a própria imagem deslocada (clone de área limpa)."""
    return np.roll(img, (dy, dx), (0, 1))


# ---------------------------------------------------------------- membrana
def _membrane(err, ring, shape_win, iters=1200):
    """Interpola o erro do anel para dentro (Laplace), multiescala."""
    hole = ~ring
    a = err.copy()
    h, w = hole.shape
    for f in (8, 4, 2, 1):
        if f > 1 and min(h // f, w // f) < 8:
            continue
        if f > 1:
            s = np.asarray(Image.fromarray((a + 128).clip(0, 255).astype(np.uint8))
                           .resize((w // f, h // f), Image.BILINEAR), np.float32) - 128
            hs = np.asarray(Image.fromarray((hole * 255).astype(np.uint8))
                            .resize((w // f, h // f), Image.BILINEAR)) > 128
        else:
            s, hs = a, hole
        for _ in range(max(80, iters // f)):
            p = np.pad(s, ((1, 1), (1, 1), (0, 0)), mode="edge")
            s = np.where(hs[..., None],
                         (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) * .25, s)
        if f > 1:
            up = np.asarray(Image.fromarray((s + 128).clip(0, 255).astype(np.uint8))
                            .resize((w, h), Image.BICUBIC), np.float32) - 128
            a = np.where(hole[..., None], up, a)
        else:
            a = s
    return a


# ------------------------------------------------------------------- apply
def apply_fill(pil, mask, src, ring=None, margin=48, noise=0.0, seed=5):
    """Compõe `src` dentro de `mask` corrigindo o degrau de borda."""
    o = np.asarray(pil.convert("RGB"), np.float32)
    if ring is None:
        ring = _ring(mask)
    ys, xs = np.where(mask > 0.02)
    y0, y1 = max(0, ys.min() - margin), min(o.shape[0], ys.max() + margin + 1)
    x0, x1 = max(0, xs.min() - margin), min(o.shape[1], xs.max() + margin + 1)

    ow, sw, rw = o[y0:y1, x0:x1], src[y0:y1, x0:x1], ring[y0:y1, x0:x1]
    err = np.zeros_like(ow)
    err[rw] = ow[rw] - sw[rw]                      # o que falta para casar a borda
    corr = _membrane(err, rw, (y1 - y0, x1 - x0))

    filled = o.copy()
    filled[y0:y1, x0:x1] = sw + corr
    if noise:
        rng = np.random.default_rng(seed)
        filled += rng.normal(0, noise, filled.shape[:2])[..., None]
    m = mask[..., None]
    return Image.fromarray((o * (1 - m) + filled * m).clip(0, 255).astype(np.uint8))


def sample_keep(a, lum=(None, None), not_green=False, not_white=True):
    """Filtro de amostragem do anel (exclui fundo, botões etc.)."""
    L = a.mean(2)
    ok = np.ones(L.shape, bool)
    if not_white: ok &= L < 245
    if lum[0] is not None: ok &= L > lum[0]
    if lum[1] is not None: ok &= L < lum[1]
    if not_green: ok &= (a[..., 1] - (a[..., 0] + a[..., 2]) / 2) < 18
    return ok
