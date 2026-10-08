# -*- coding: utf-8 -*-
"""Ajustes finos sobre o recorte do Vision.

O Vision acerta o contorno externo, mas duas coisas sobram:

1. **Furo passante** — ele trata o vazado como parte do assunto, então a bancada
   aparece dentro do furo (arruela e anel trava). Detectar isso pela cor não
   funciona: dentro do furo o tampo fica na sombra e com dominante própria, e
   qualquer limiar que pegue o furo de uma foto come a peça de outra (medido:
   no bocal o mesmo limiar removia 27% da peça, que o Vision já tinha acertado).
   Então o furo é **declarado** por foto, como uma caixa em coordenadas relativas
   à peça; dentro dela um teste local separa peça de fundo, o que é bem posto
   porque a cor da peça vem do anel imediatamente em volta da caixa.

2. **Franja** — a borda sai com alpha parcial e alguns pixels do fundo, o que
   vira um contorno felpudo sobre o branco (visível no anel trava).
"""
import numpy as np
from PIL import Image, ImageFilter


def _img(m):
    return Image.fromarray((m * 255).astype(np.uint8), "L")


def _min(m, r):
    return np.array(_img(m).filter(ImageFilter.MinFilter(r))) > 127


def _max(m, r):
    return np.array(_img(m).filter(ImageFilter.MaxFilter(r))) > 127


def _odd(v, minimo=3):
    return max(minimo, int(v) | 1)


def tirar_franja(part, erosao=5):
    """Alpha binário e levemente erodido: mata o halo semitransparente da borda."""
    a = np.asarray(part.split()[-1], dtype=np.uint8)
    m = _min(a > 140, _odd(erosao))
    alpha = np.array(_img(m).filter(ImageFilter.GaussianBlur(0.7)))
    return Image.fromarray(np.dstack([np.asarray(part.convert("RGB")), alpha]), "RGBA")


def _solidificar(furo, caixa):
    """Fecha o furo como forma convexa: interseção do preenchimento por linha e por
    coluna. Vazado passante é simples e convexo, então o que sobra de resíduo nas
    bordas (parede do furo, reflexo) some sem inventar área fora da caixa."""
    ys, xs = np.where(furo)
    if ys.size == 0:
        return furo
    lin = np.zeros_like(furo)
    col = np.zeros_like(furo)
    for y in np.unique(ys):
        x = xs[ys == y]
        lin[y, x.min():x.max() + 1] = True
    for x in np.unique(xs):
        y = ys[xs == x]
        col[y.min():y.max() + 1, x] = True
    return lin & col & caixa


def _retangulo(furo, caixa, margem_px):
    """Furo como retângulo cheio: a caixa envolvente do que foi detectado, com uma
    folga. Para janela retangular (arruela) isso dá o resultado limpo que o teste
    de cor não alcança — a parede do furo e o reflexo na borda têm a cor da peça."""
    ys, xs = np.where(furo)
    if ys.size == 0:
        return furo
    r = np.zeros_like(furo)
    m = int(margem_px)
    y0, y1 = max(0, ys.min() - m), min(furo.shape[0], ys.max() + 1 + m)
    x0, x1 = max(0, xs.min() - m), min(furo.shape[1], xs.max() + 1 + m)
    r[y0:y1, x0:x1] = True
    return r & caixa


def remover_furo(part, orig, caixas, tol=3.2, minimo=0.004, solido=True, forma="auto"):
    """Apaga o fundo visível pelos vazados.

    caixas: lista de (x0, y0, x1, y1) em fração da caixa envolvente da peça.
    Dentro de cada caixa, é fundo o que se afasta da cor da peça medida no anel
    logo em volta da caixa (mediana + MAD por canal).
    """
    rgb = np.asarray(orig.convert("RGB"), dtype=np.float32)
    a = np.asarray(part.split()[-1], dtype=np.uint8)
    dentro = a > 128
    bb = part.getbbox()
    if not bb or not dentro.any():
        return part
    x0b, y0b, x1b, y1b = bb
    Lw, Lh = x1b - x0b, y1b - y0b

    furo_total = np.zeros_like(dentro)
    for (fx0, fy0, fx1, fy1) in caixas:
        cx0, cx1 = int(x0b + Lw * fx0), int(x0b + Lw * fx1)
        cy0, cy1 = int(y0b + Lh * fy0), int(y0b + Lh * fy1)
        caixa = np.zeros_like(dentro)
        caixa[cy0:cy1, cx0:cx1] = True

        # cor da peça: o anel de material logo em volta da caixa do furo
        anel = _max(caixa, _odd(min(Lw, Lh) * 0.10, 9)) & ~caixa & dentro
        if anel.sum() < 200:
            continue
        med = np.median(rgb[anel], axis=0)
        mad = np.median(np.abs(rgb[anel] - med), axis=0) + 5.0

        furo = (((np.abs(rgb - med) / mad).max(axis=2) > tol) & caixa & dentro)
        furo = _max(_min(furo, 5), 7)                    # tira respingo, recompõe a área
        r = _odd(min(Lw, Lh) * 0.05, 7)
        nucleo = _min(furo, r)
        if not nucleo.any():
            continue
        furo = _max(nucleo, r + 6) & furo                # só o vazado grande sobrevive
        if furo.sum() < dentro.sum() * minimo:
            continue
        if forma == "retangulo":
            furo = _retangulo(furo, caixa, min(Lw, Lh) * 0.038)
        elif solido:
            furo = _solidificar(furo, caixa)
        furo_total |= furo & dentro

    m = dentro & ~furo_total
    alpha = np.array(_img(m).filter(ImageFilter.GaussianBlur(0.8)))
    return Image.fromarray(np.dstack([np.asarray(part.convert("RGB")), alpha]), "RGBA")
