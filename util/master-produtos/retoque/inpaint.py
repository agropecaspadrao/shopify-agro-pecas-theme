# -*- coding: utf-8 -*-
"""Inpainting sem OpenCV: interpolação direcional + refino por difusão (Jacobi
multiescala). Feito para apagar logo/texto sobre gradiente suave ou cor chapada."""
import numpy as np
from PIL import Image, ImageFilter


def _interp_axis(img, mask, axis):
    """Interpola linearmente ao longo de um eixo entre as bordas válidas."""
    if axis == 1:
        img = img.transpose(1, 0, 2); mask = mask.T
    H, W, C = img.shape
    out = np.zeros_like(img); wgt = np.zeros((H, W), np.float32)
    idx = np.arange(H, dtype=np.float32)[:, None]
    valid = ~mask
    # último válido acima
    up_i = np.where(valid, idx, -1e9)
    up_i = np.maximum.accumulate(up_i, axis=0)
    # primeiro válido abaixo
    dn_i = np.where(valid, idx, 1e9)
    dn_i = np.minimum.accumulate(dn_i[::-1], axis=0)[::-1]
    ok_u = up_i > -1e8; ok_d = dn_i < 1e8
    ui = np.clip(up_i, 0, H - 1).astype(np.int32)
    di = np.clip(dn_i, 0, H - 1).astype(np.int32)
    cols = np.arange(W)[None, :]
    Vu = img[ui, cols]; Vd = img[di, cols]
    du = np.abs(idx - up_i); dd = np.abs(dn_i - idx)
    du = np.where(ok_u, du, 1e9); dd = np.where(ok_d, dd, 1e9)
    tot = du + dd
    both = ok_u & ok_d
    a = np.where(both, dd / np.maximum(tot, 1e-6), np.where(ok_u, 1.0, 0.0))
    val = Vu * a[..., None] + Vd * (1 - a)[..., None]
    val = np.where((ok_u | ok_d)[..., None], val, 0)
    w = np.where(both, 1.0 / np.maximum(np.minimum(du, dd), 1.0),
                 np.where(ok_u | ok_d, 0.15, 0.0)).astype(np.float32)
    out, wgt = val, w
    if axis == 1:
        out = out.transpose(1, 0, 2); wgt = wgt.T
    return out, wgt


def _diffuse(img, mask, iters):
    """Jacobi: cada pixel do buraco vira a média dos 4 vizinhos."""
    a = img.copy()
    m3 = mask[..., None]
    for _ in range(iters):
        p = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) * 0.25
        a = np.where(m3, avg, a)
    return a


def inpaint(pil, mask, refine=220, feather=1.2):
    """pil: PIL.Image RGB. mask: bool HxW (True = apagar)."""
    img = np.asarray(pil.convert("RGB"), np.float32)
    if not mask.any():
        return pil
    hv, wv = _interp_axis(img, mask, 0)
    hh, wh = _interp_axis(img, mask, 1)
    tot = wv + wh
    init = np.where(tot[..., None] > 0,
                    (hv * wv[..., None] + hh * wh[..., None]) / np.maximum(tot, 1e-6)[..., None],
                    img)
    out = np.where(mask[..., None], init, img)

    # refino multiescala: resolve o buraco grande no nível grosseiro
    if refine:
        h, w = mask.shape
        for f in (8, 4, 2):
            if min(h // f, w // f) < 8:
                continue
            small = Image.fromarray(out.clip(0, 255).astype(np.uint8)).resize((w // f, h // f), Image.BILINEAR)
            ms = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((w // f, h // f), Image.BILINEAR)) > 40
            d = _diffuse(np.asarray(small, np.float32), ms, refine)
            big = np.asarray(Image.fromarray(d.clip(0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32)
            out = np.where(mask[..., None], big, out)
        out = _diffuse(out, mask, max(24, refine // 6))

    res = np.where(mask[..., None], out, img)

    # feather: suaviza só a borda do remendo
    if feather:
        blur = np.asarray(Image.fromarray(res.clip(0, 255).astype(np.uint8))
                          .filter(ImageFilter.GaussianBlur(feather)), np.float32)
        edge = np.asarray(Image.fromarray((mask * 255).astype(np.uint8))
                          .filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255.0
        edge = np.clip(edge * (1 - mask.astype(np.float32)) * 2.2, 0, 1)
        res = res * (1 - edge[..., None]) + blur * edge[..., None]

    return Image.fromarray(res.clip(0, 255).astype(np.uint8))


def grain(pil, mask, amount=2.0, seed=7):
    """Devolve um pouco de ruído ao remendo para não ficar liso demais."""
    a = np.asarray(pil.convert("RGB"), np.float32)
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, a.shape[:2])[..., None]
    return Image.fromarray(np.where(mask[..., None], a + n, a).clip(0, 255).astype(np.uint8))


def box_mask(shape, rels, soft=0):
    """Máscara a partir de caixas relativas (x0,y0,x1,y1)."""
    h, w = shape
    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in rels:
        m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    if soft:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8))
                       .filter(ImageFilter.MaxFilter(soft * 2 + 1))) > 127
    return m
