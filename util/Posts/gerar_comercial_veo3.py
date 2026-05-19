#!/usr/bin/env python3
"""
Gerador de Reels — APP Agro Peças Padrão
Pipeline: Veo 2 (Vertex AI) → ElevenLabs TTS → ffmpeg composição

Uso:
    cp .env.example .env  # preenche ELEVENLABS_API_KEY
    python3 gerar_comercial_veo3.py [etapa]

Etapas (opcional — padrão "tudo"):
    refs      só as imagens de referência
    audios    só as narrações (ElevenLabs TTS)
    brutos    só os vídeos brutos (Veo)
    finais    os clipes finais (gera o que faltar de bruto/áudio antes)
    completo  clipes finais + vídeo completo + cortes por produto
    tudo      pipeline inteiro

O que já existe não é regerado: imagens de referência, áudios, vídeos
brutos e clipes finais são reaproveitados; só o que falta é gerado.

Dependências:
    pip install pillow python-dotenv requests elevenlabs
    brew install ffmpeg
"""

from __future__ import annotations

import argparse
import base64
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from PIL import Image

# ── Ambiente ──────────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ASSETS_DIR = Path(os.getenv("ASSETS_DIR",
    "/Users/guilhermeferreira/Documents/DEV/shopify-agro-pecas-theme/assets"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR",
    "/Users/guilhermeferreira/Documents/DEV/shopify-agro-pecas-theme/util/Posts/comercial_app_veo3"))

# Vertex AI — Veo 2
GCP_PROJECT = "gen-lang-client-0608451405"
GCP_LOCATION = "us-central1"
VEO_MODEL   = "veo-2.0-generate-001"
GCS_BUCKET  = "gs://app-agropecas-videos-output"

LOGO_SRC  = ASSETS_DIR / "APP - LOGO Quadrada SEM FUNDO.png"
FONT_NAME = "BarlowCondensed-ExtraBold"  # fallback para Impact se ausente
FFMPEG    = "ffmpeg"

# Fundos de cena (compositados como imagem de referência para o Veo)
BG_ABERTURA  = ASSETS_DIR / "fundo_agro_logo_abertura_fechamento..avif"  # abertura/fechamento
BG_EXPOSITOR = ASSETS_DIR / "fundo_agro_3D_exporsitor_1.jpg"             # mesa dos produtos

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("app-reels")

# ── Watermark config ──────────────────────────────────────────────────────────

WATERMARK = {
    "width_px":        120,
    "margin_right_px": 60,
    "margin_bottom_px": 260,   # acima da UI do Instagram Reels
    "opacity":         1.0,
}

# ── Estilos de texto ──────────────────────────────────────────────────────────

TEXT_STYLES = {
    "hook": {"fontsize": 64, "accent": False},
    "body": {"fontsize": 52, "accent": False},
    "cta":  {"fontsize": 56, "accent": True},
}

# ── Timing da composição ──────────────────────────────────────────────────────
# A duração de cada clipe é derivada do MP3 de narração: o vídeo começa após um
# pré-roll, cobre toda a narração e termina transicionando para a logo.

PRE_DELAY = 0.5   # pré-roll padrão antes do vídeo iniciar (s)
VO_OFFSET = 0.25  # respiro após o pré-roll antes de a narração começar (s)
OUTRO_DUR = 1.8   # duração da segura na logo ao final de cada clipe de produto (s)
XFADE_DUR = 0.6   # crossfade vídeo → logo (s)

# Abertura / encerramento: a música entra após um pequeno delay, a narração
# começa em LOGO_VO_START e o tema segura LOGO_TAIL após a narração (volume
# suavizado pelo fade-out).
LOGO_VO_START = 5.0   # narração da abertura/fechamento inicia em 5 s
LOGO_TAIL     = 2.0   # segura o tema 2 s após a narração, suavizando o volume

# ── Helpers de ambiente ───────────────────────────────────────────────────────

def gcp_token() -> str:
    r = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True,
    )
    tok = r.stdout.strip()
    if not tok:
        sys.exit("❌ Token GCP não disponível. Execute: gcloud auth application-default login")
    return tok


def find_font() -> str:
    """Localiza Barlow Condensed ExtraBold ou cai em DejaVu/Impact."""
    candidates = [
        "/opt/homebrew/share/fonts/BarlowCondensed-ExtraBold.ttf",
        str(Path.home() / "Library/Fonts/BarlowCondensed-ExtraBold.ttf"),
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/opt/homebrew/share/fonts/dejavu-fonts/DejaVuSans-Bold.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return ""   # ffmpeg usará fonte default


# ── A — Pré-processamento da logo ─────────────────────────────────────────────

def prep_logo(logo_path: Path, out_size: int = 512) -> Path:
    """
    Logo watermark dentro de círculo branco (padrão dos posts do Instagram).
    Círculo branco preenche o canvas; logo centralizada ocupando 76%.
    """
    from PIL import ImageDraw

    out_path = logo_path.parent / f"{logo_path.stem}_circle_512px.png"
    if out_path.exists():
        return out_path

    logo = Image.open(logo_path).convert("RGBA")
    inner = int(out_size * 0.76)
    logo = logo.resize((inner, inner), Image.LANCZOS)

    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    mask = Image.new("L", (out_size, out_size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, out_size - 1, out_size - 1], fill=255)

    circle = Image.new("RGBA", (out_size, out_size), (255, 255, 255, 255))
    canvas.paste(circle, (0, 0), mask)

    off = (out_size - inner) // 2
    canvas.paste(logo, (off, off), logo)
    canvas.save(out_path, "PNG")
    log.info("Logo watermark (círculo branco) → %s", out_path.name)
    return out_path


# ── A2 — Fundos compositados (referência para o Veo) ─────────────────────────

def _load_image(path: Path) -> "Image.Image":
    """Abre uma imagem; usa ffmpeg como fallback p/ formatos sem suporte (AVIF)."""
    try:
        return Image.open(path).convert("RGBA")
    except Exception:
        conv = path.parent / f"{path.stem}_conv.png"
        subprocess.run([FFMPEG, "-y", "-i", str(path), str(conv)],
                       capture_output=True, text=True, check=True)
        return Image.open(conv).convert("RGBA")


def _prep_canvas(bg_path: Path, size: tuple[int, int] = (1080, 1920)) -> "Image.Image":
    """Carrega um fundo, recorta em cover-fit p/ 9:16 e ajusta nitidez/cor."""
    from PIL import ImageEnhance, ImageFilter

    img = _load_image(bg_path).convert("RGB")
    tw, th = size
    sc = max(tw / img.width, th / img.height)
    img = img.resize((round(img.width * sc), round(img.height * sc)), Image.LANCZOS)
    l = (img.width - tw) // 2
    t = (img.height - th) // 2
    img = img.crop((l, t, l + tw, t + th))
    # Realça nitidez e resolução do fundo (a imagem de origem é pequena/borrada)
    img = img.filter(ImageFilter.UnsharpMask(radius=2.4, percent=150, threshold=2))
    img = ImageEnhance.Sharpness(img).enhance(1.3)
    img = ImageEnhance.Color(img).enhance(1.08)
    return img.convert("RGBA")


def _cutout(img: "Image.Image") -> "Image.Image":
    """Remove o fundo claro/branco conectado às bordas (flood-fill por canto)."""
    import numpy as np
    from PIL import ImageDraw

    rgb = img.convert("RGB")
    flood = rgb.copy()
    w, h = flood.size
    marker = (1, 2, 3)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(flood, seed, marker, thresh=42)
    mask = np.all(np.array(flood) == marker, axis=-1)
    arr = np.dstack([np.array(rgb),
                     np.where(mask, 0, 255).astype("uint8")])
    return Image.fromarray(arr).convert("RGBA")


def prep_logo_on_bg(logo_path: Path, bg_path: Path) -> Path:
    """
    Referência da abertura/fechamento: logo APP centralizada, com halo branco,
    sobre o fundo agro (campo + pôr do sol) recortado em 9:16.
    """
    from PIL import ImageFilter

    out_path = OUTPUT_DIR / "_tmp" / "ref_logo_abertura_1080.png"
    if out_path.exists():
        log.info("  ↩ Referência abertura já existe: %s", out_path.name)
        return out_path
    canvas = _prep_canvas(bg_path)
    cw, ch = canvas.size
    # Véu verde suave p/ a logo respirar sobre o fundo
    canvas = Image.alpha_composite(canvas, Image.new("RGBA", canvas.size, (27, 67, 50, 95)))

    logo_size = int(cw * 0.62)
    logo = Image.open(logo_path).convert("RGBA").resize((logo_size, logo_size), Image.LANCZOS)
    off = ((cw - logo_size) // 2, (ch - logo_size) // 2)

    alpha = logo.split()[3]
    white = Image.new("RGBA", logo.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    glow = white.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(12))
    edge = white.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2))
    canvas.alpha_composite(glow, off)
    canvas.alpha_composite(edge, off)
    canvas.alpha_composite(logo, off)

    canvas.convert("RGB").save(out_path, "PNG")
    log.info("Referência abertura/fechamento → %s", out_path.name)
    return out_path


def prep_product_on_table(product_path: Path, table_bg: Path, label: str) -> Path:
    """
    Referência de produto: produto recortado, posicionado sobre a mesa do fundo
    `fundo_agro_3D_exporsitor`, em escala proporcional e com sombra de contato.
    """
    from PIL import ImageDraw, ImageFilter

    out_path = OUTPUT_DIR / "_tmp" / f"ref_{label}.png"
    if out_path.exists():
        log.info("  ↩ Referência produto %s já existe: %s", label, out_path.name)
        return out_path
    canvas = _prep_canvas(table_bg)
    cw, ch = canvas.size

    prod = _cutout(_load_image(product_path))
    bbox = prod.getbbox()
    if bbox:
        prod = prod.crop(bbox)

    # Escala proporcional: altura ~28% do quadro, largura no máx. 56%
    sc = (ch * 0.28) / prod.height
    if prod.width * sc > cw * 0.56:
        sc = (cw * 0.56) / prod.width
    pw = max(1, round(prod.width * sc))
    ph = max(1, round(prod.height * sc))
    prod = prod.resize((pw, ph), Image.LANCZOS)

    contact_y = int(ch * 0.84)          # base do produto apoiada no tampo da mesa
    px = (cw - pw) // 2
    py = contact_y - ph

    # Sombra de contato elíptica e difusa, logo abaixo da base do produto
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sw, sh = int(pw * 1.0), int(ph * 0.13)
    cy = contact_y - sh // 4
    ImageDraw.Draw(shadow).ellipse(
        [cw // 2 - sw // 2, cy - sh // 2, cw // 2 + sw // 2, cy + sh // 2],
        fill=(0, 0, 0, 150),
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(20)))
    canvas.alpha_composite(prod, (px, py))

    canvas.convert("RGB").save(out_path, "PNG")
    log.info("Referência produto %s → %s", label, out_path.name)
    return out_path


# ── Cenas (definidas após LOGO_READY ser resolvida em main) ───────────────────

def build_scenes(ref_abertura: Path) -> list[dict]:
    lv = str(ref_abertura)   # logo APP sobre o fundo agro (campo + pôr do sol)

    def table(img: str, label: str) -> str:
        """Composita o produto sobre a mesa do fundo e devolve o caminho da referência."""
        return str(prep_product_on_table(ASSETS_DIR / img, BG_EXPOSITOR, label))

    # Cenário compartilhado por todas as cenas de produto — a mesa do fundo agro.
    TABLE_BG = (
        "Setting: the product rests on the flat top of a round rustic wooden table. "
        "Behind it, a softly blurred green agricultural field under a calm bright sky — "
        "shallow depth of field, the field stays out of focus so the product is the clear subject. "
        "Warm natural daylight, a soft realistic contact shadow where the product meets the wood. "
        "Keep this SAME wooden-table-and-field setting in every product shot. "
        "No people, no machinery, no extra props on the table. "
    )

    # Movimento padrão dos produtos — APENAS um giro de câmera frontal em loop
    # (efeito bumerangue), o produto em si permanece imóvel.
    TURN = (
        "Motion: the PRODUCT stays completely still, locked in place on the table — "
        "it does NOT rotate, does NOT spin, does NOT move at all. "
        "ONLY the camera moves: a smooth, slow, professional frontal camera pan that glides "
        "gently from one side to the other and back again — a seamless boomerang loop, "
        "left to right to left — always keeping the product's front face centered in frame. "
        "The camera arc is subtle and elegant, just enough to feel premium and alive. "
        "Absolutely NO hands, NO people, NO tools, NO machinery, NO extra objects — "
        "nothing external ever enters the frame. "
        "Do NOT alter the product's shape, color, labels, markings or any characteristic. "
    )

    # Instrução de framing repetida em todos os prompts de produto
    FRAME = (
        "CRITICAL FRAMING RULES: "
        "The reference image MUST be reproduced faithfully — preserve exact shape, color, labels, markings, and proportions of the product. "
        "Product must be fully visible at all times, NEVER cropped, NEVER cut at any edge. "
        "Product centered horizontally and resting on the table, proportionally sized — neither tiny nor oversized. "
        "No zoom past the product boundaries. No generated text, no hallucinated text. "
        "Keep the product's original colors, materials, and surface finish exactly as in reference. "
    )

    return [
        # ── 01 Abertura ──────────────────────────────────────────────────────
        {
            "label": "01_abertura_logo",
            "is_logo": True,
            "mode":  "image",
            "image_path": lv,
            "aspect_ratio": "9:16",
            "resolution": "1080x1920",
            "fps": 30,
            "duration_seconds": 8,
            # Pré-roll: a música entra após este delay; a narração começa em 5 s.
            "start_delay": 1.0,
            "prompt": (
                "Vertical 9:16 format 1080x1920, 30fps. "
                "The reference image shows the APP Agro Peças Padrão logo centered over a warm agricultural background — "
                "a green crop field at golden sunset — with a bright white halo glow outlining the whole logo. "
                "Reproduce this composition exactly, KEEPING the white halo glow around the logo and the field-at-sunset background. "
                "Logo stays centered, NEVER zoomed in, NEVER cropped. "
                "0-2s: soft golden sunset light rays emerge from behind the logo, the warm glow builds gently. "
                "2-5s: gentle god-ray beams, golden dust particles and soft light drift slowly across the field. "
                "5-8s: logo holds perfectly centered and sharp, with a soft pulsing golden halo over the calm sunset field. "
                "Camera: ZERO zoom movement, no camera push-in. Static composition with only lighting animation. "
                "No text. 8K photoreal cinematic. "
                "CRITICAL: logo must remain fully visible, centered, never cropped at any frame."
            ),
            "voiceover": {
                "script": "APP Agro Peças Padrão. Qualidade certificada para quem não pode parar.",
                "timing_start_sec": 5.0,
                "voice_id": "nPczCjzI2devNBz1zQrb",
                "stability": 0.85, "similarity_boost": 0.75, "style": 0.2,
            },
            "music": {"volume_db": -16, "fade_in": 0.5, "fade_out": 1.0},
            "overlay_text": [],
        },
        # ── 02 Reservatório de Sementes ──────────────────────────────────────
        {
            "label": "02_reservatorio_sementes",
            "mode":  "image",
            "image_path": table("agco_ACX3454710_ecommerce_2.png", "02_reservatorio_sementes"),
            "aspect_ratio": "9:16",
            "resolution": "1080x1920",
            "fps": 30,
            "duration_seconds": 8,
            "start_delay": 0.5,
            "prompt": (
                "Vertical 9:16 format 1080x1920, 30fps. 8 seconds. "
                "The reference image shows a gray-blue cylindrical plastic seed reservoir resting on a round wooden table, "
                "with a flat lid, a side outlet tube and mounting brackets. "
                "Preserve the exact gray-blue matte plastic color, cylindrical shape, lid and outlet tube from the reference. "
                "Keep the product resting on the wooden table exactly where it is, proportionally sized. "
                "Soft warm daylight, gentle golden rim light tracing the edges. "
                + TURN + TABLE_BG + FRAME +
                "4K photoreal commercial product photography. No text, no people, no generated labels."
            ),
            "voiceover": {
                "script": (
                    "Reservatório de sementes quebrou? "
                    "Na APP você encontra o componente padrão original. "
                    "Peças com certificação de qualidade e atendimento técnico especializado. "
                    "Sem espera sem demora. Chame no WhatsApp."
                ),
                "timing_start_sec": 0.8,
                "voice_id": "nPczCjzI2devNBz1zQrb",
                "stability": 0.80, "similarity_boost": 0.78, "style": 0.25,
            },
            "music": {"volume_db": -22, "fade_in": 0.3, "fade_out": 0.8},
            "overlay_text": [
                {"text": "Reservatório de Sementes quebrou?",  "start": 0.5, "end": 3.0, "pos": "top",    "style": "hook"},
                {"text": "AGCO ACX3454710 — original",       "start": 3.2, "end": 5.8, "pos": "top",    "style": "body"},
                {"text": "Peça pelo WhatsApp →",             "start": 6.0, "end": 7.8, "pos": "bottom", "style": "cta"},
            ],
        },
        # ── 03 GPS GR200 Greco ───────────────────────────────────────────────
        {
            "label": "03_gps_gr200_greco",
            "mode":  "image",
            "image_path": table("greco_GR141207_ecommerce.png", "03_gps_gr200_greco"),
            "aspect_ratio": "9:16",
            "resolution": "1080x1920",
            "fps": 30,
            "duration_seconds": 8,
            "start_delay": 0.5,
            "prompt": (
                "Vertical 9:16 format 1080x1920, 30fps. 8 seconds. "
                "The reference image shows a black rectangular GPS agricultural precision monitor (GR200 by Greco Agro Tech) "
                "resting on a round wooden table — a matte black display device with rounded corners and a screen. "
                "Reproduce the device PIXEL-FAITHFULLY: identical matte black color, identical rectangular shape, "
                "identical proportions, identical buttons, identical bezel and screen layout as the reference. "
                "Do NOT change the device, do NOT add features, do NOT alter its outline. "
                "Keep every screen element (graphics, numbers, icons, interface) exactly as in the reference. "
                + TURN + TABLE_BG + FRAME +
                "4K photoreal product photography. No added text, no hallucinated logos or numbers."
            ),
            "voiceover": {
                "script": (
                    "Agricultura de precisão começa com a ferramenta certa. "
                    "O GPS GR200 da Greco Agro Tech oferece navegação de precisão para o campo. "
                    "Reduza desperdício, aumente produtividade e plante com mais exatidão. "
                    "APP Agro Peças Padrão — distribuidor autorizado Greco."
                ),
                "timing_start_sec": 0.7,
                "voice_id": "nPczCjzI2devNBz1zQrb",
                "stability": 0.82, "similarity_boost": 0.76, "style": 0.22,
            },
            "music": {"volume_db": -22, "fade_in": 0.3, "fade_out": 0.8},
            "overlay_text": [
                {"text": "Navegação de Precisão no Campo",    "start": 0.5, "end": 3.0, "pos": "top",    "style": "hook"},
                {"text": "GPS GR200 — Greco Agro Tech",        "start": 3.2, "end": 5.8, "pos": "top",    "style": "body"},
                {"text": "Consulte disponibilidade →",         "start": 6.0, "end": 7.8, "pos": "bottom", "style": "cta"},
            ],
        },
        # ── 04 Bomba hidráulica Massey Ferguson ──────────────────────────────
        {
            "label": "04_bomba_hidraulica_massey",
            "mode":  "image",
            "image_path": table("livenza_5.0220.0547201-CT_REV._0_p1.png", "04_bomba_hidraulica_massey"),
            "aspect_ratio": "9:16",
            "resolution": "1080x1920",
            "fps": 30,
            "duration_seconds": 8,
            "start_delay": 0.5,
            "prompt": (
                "Vertical 9:16 format 1080x1920, 30fps. 8 seconds. "
                "The reference image shows a double-section hydraulic steering pump resting on a round wooden table — "
                "cast iron and aluminum body, two cylindrical pump sections side by side with a central drive shaft "
                "protruding from the front, multiple bolt holes on the mounting face, silver-gray machined metal finish. "
                "This is a Massey Ferguson tractor hydraulic steering pump (Livenza, ISO 9001 / 14001 / 18001 certified). "
                "Preserve the exact cast iron gray color, dual-body shape, mounting holes and shaft from the reference. "
                "Keep the whole pump resting on the wooden table, clearly and fully visible, proportionally sized. "
                "Soft warm daylight, golden rim light tracing the machined metal surfaces. "
                "NO tractors, NO machinery, NO workshop, NO people anywhere in the shot. "
                + TURN + TABLE_BG + FRAME +
                "4K macro photoreal commercial product photography. No text, no people, no labels."
            ),
            "voiceover": {
                "script": (
                    "Bomba hidráulica de direção. "
                    "Fabricada com certificação ISO. "
                    "Padrão original, entrega rápida, suporte técnico garantido. "
                    "APP Agro Peças Padrão — a peça certa para o seu trator."
                ),
                "timing_start_sec": 0.6,
                "voice_id": "nPczCjzI2devNBz1zQrb",
                "stability": 0.83, "similarity_boost": 0.77, "style": 0.20,
            },
            "music": {"volume_db": -22, "fade_in": 0.3, "fade_out": 0.8},
            "overlay_text": [
                {"text": "Bomba hidráulica MF — original",        "start": 0.5, "end": 3.0, "pos": "top",    "style": "hook"},
                {"text": "Livenza — ISO 9001 · 14001 · 18001",    "start": 3.2, "end": 5.8, "pos": "top",    "style": "body"},
                {"text": "Fale no WhatsApp →",                    "start": 6.0, "end": 7.8, "pos": "bottom", "style": "cta"},
            ],
        },
        # ── 05 Encerramento CTA ──────────────────────────────────────────────
        {
            "label": "05_encerramento_cta",
            "is_logo": True,
            "mode":  "image",
            "image_path": lv,
            "aspect_ratio": "9:16",
            "resolution": "1080x1920",
            "fps": 30,
            "duration_seconds": 8,
            "start_delay": 1.0,
            "prompt": (
                "Vertical 9:16 format 1080x1920, 30fps. 8 seconds total. "
                "The reference image shows the APP Agro Peças Padrão logo centered over a warm agricultural background — "
                "a green crop field at golden sunset — with a bright white halo glow outlining the whole logo. "
                "Reproduce this composition exactly, KEEPING the white halo glow around the logo and the field-at-sunset background. "
                "Logo centered, NEVER zoomed in, NEVER cropped. "
                "0-3s: logo holds centered with a warm golden halo pulsing very gently once. "
                "3-6s: golden dust particles and soft sunset light drift slowly across the field. "
                "6-8s: completely static hold — logo sharp, centered, a premium brand statement over the calm sunset field. "
                "ZERO camera movement. No text in source video. 8K quality photoreal cinematic. "
                "CRITICAL: logo must remain fully visible, centered, never cropped at any frame."
            ),
            "voiceover": {
                "script": (
                    "APP Agro Peças Padrão. "
                    "Peças originais. Atendimento técnico de verdade. Entrega rápida. "
                    "Porque no campo, tempo é dinheiro — "
                    "e você merece um fornecedor que entende isso. "
                    "Acesse agro peças padrão ponto com ponto br "
                    "ou chame a gente no WhatsApp."
                ),
                "timing_start_sec": 5.0,
                "voice_id": "nPczCjzI2devNBz1zQrb",
                "stability": 0.88, "similarity_boost": 0.74, "style": 0.15,
            },
            "music": {"volume_db": -16, "fade_in": 0.3, "fade_out": LOGO_TAIL},
            "overlay_text": [
                {"text": "agropecaspadrao.com.br", "start": 7.0, "end": 99.0, "pos": "top",    "style": "body"},
                {"text": "+55 41 98415-1085",      "start": 8.2, "end": 99.0, "pos": "bottom", "style": "cta"},
            ],
        },
    ]


# ── B — Watermark via ffmpeg ──────────────────────────────────────────────────

def apply_watermark(video_path: Path, logo_512: Path, out_path: Path) -> None:
    """
    Composita a logo 512px no canto inferior direito com opacidade 0.88.
    Usa ffmpeg overlay com lut de opacidade.
    """
    wm = WATERMARK
    opacity = wm["opacity"]
    w       = wm["width_px"]
    mr      = wm["margin_right_px"]
    mb      = wm["margin_bottom_px"]

    # x = W - watermark_width - margin_right
    # y = H - watermark_height - margin_bottom  (height proporcional ao width)
    overlay_filter = (
        f"[1:v]scale={w}:-1,format=rgba,"
        f"colorchannelmixer=aa={opacity}[wm];"
        f"[0:v][wm]overlay=x=W-w-{mr}:y=H-h-{mb}"
    )

    cmd = [
        FFMPEG, "-y",
        "-i", str(video_path),
        "-i", str(logo_512),
        "-filter_complex", overlay_filter,
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-c:a", "copy",
        "-r", "30",
        str(out_path),
    ]
    _run(cmd, f"watermark → {out_path.name}")


# ── C-D — Veo 2 (Vertex AI) — geração do clipe bruto ─────────────────────────

def _veo_request(payload: dict, token: str) -> str | None:
    url = (
        f"https://{GCP_LOCATION}-aiplatform.googleapis.com/v1"
        f"/projects/{GCP_PROJECT}/locations/{GCP_LOCATION}"
        f"/publishers/google/models/{VEO_MODEL}:predictLongRunning"
    )
    resp = requests.post(
        url, json=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=60,
    )
    if resp.status_code != 200:
        log.error("Veo API HTTP %s: %s", resp.status_code, resp.text[:400])
        return None
    return resp.json().get("name")


def _veo_poll(op_name: str, token: str, timeout: int = 900) -> dict | None:
    url = (
        f"https://{GCP_LOCATION}-aiplatform.googleapis.com/v1"
        f"/projects/{GCP_PROJECT}/locations/{GCP_LOCATION}"
        f"/publishers/google/models/{VEO_MODEL}:fetchPredictOperation"
    )
    deadline = time.time() + timeout
    attempt  = 0
    while time.time() < deadline:
        try:
            resp = requests.post(
                url,
                json={"operationName": op_name},
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=30,
            )
            if resp.status_code == 200 and resp.text.strip():
                data = resp.json()
                if data.get("done"):
                    if "error" in data:
                        log.error("Veo error: %s", data["error"])
                        return None
                    return data.get("response") or data
        except Exception as exc:
            log.warning("poll error: %s", exc)
        attempt += 1
        log.info("  … gerando vídeo (%ds)", attempt * 15)
        time.sleep(15)
        if attempt % 20 == 0:
            token = gcp_token()
    log.error("Timeout após %ds", timeout)
    return None


def _img_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def gerar_video_bruto(scene: dict, out_path: Path) -> bool:
    """Chama Veo 2 e baixa o .mp4 bruto. Retorna True se sucesso."""
    if out_path.exists():
        log.info("  ↩ Vídeo bruto já existe: %s", out_path.name)
        return True

    token = gcp_token()

    instance: dict[str, Any] = {"prompt": scene["prompt"]}
    if scene["mode"] == "image":
        img_path = scene["image_path"]
        if not Path(img_path).exists():
            log.error("  ✗ Imagem não encontrada: %s", img_path)
            return False
        ext = Path(img_path).suffix.lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext, "image/png")
        instance["image"] = {"bytesBase64Encoded": _img_b64(img_path), "mimeType": mime}

    payload = {
        "instances": [instance],
        "parameters": {
            "aspectRatio":     scene["aspect_ratio"],
            "durationSeconds": scene["duration_seconds"],
            "sampleCount":     1,
            "storageUri":      GCS_BUCKET,
        },
    }

    op = _veo_request(payload, token)
    if not op:
        return False
    log.info("  ⏳ Operação: %s", op.split("/")[-1])

    token = gcp_token()
    resp  = _veo_poll(op, token)
    if not resp:
        return False

    videos = resp.get("videos") or resp.get("predictions") or []
    gcs_uri = None
    for v in videos:
        gcs_uri = v.get("gcsUri") or v.get("video", {}).get("gcsUri")
        if gcs_uri:
            break

    if not gcs_uri:
        log.error("  ✗ URI do vídeo não encontrado: %s", str(resp)[:200])
        return False

    token = gcp_token()
    return _baixar_gcs(gcs_uri, out_path, token)


def _baixar_gcs(gcs_uri: str, dest: Path, token: str) -> bool:
    path   = gcs_uri.replace("gs://", "")
    bucket, *parts = path.split("/")
    url = f"https://storage.googleapis.com/{bucket}/{'/'.join(parts)}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=120, stream=True)
    if resp.status_code != 200:
        log.error("Download falhou HTTP %s", resp.status_code)
        return False
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(8192):
            f.write(chunk)
    log.info("  ✅ Vídeo bruto salvo: %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
    return True


# ── E — ElevenLabs TTS ────────────────────────────────────────────────────────

def gerar_tts(scene: dict, out_path: Path) -> bool:
    """Gera narração via ElevenLabs e salva como .mp3."""
    if out_path.exists():
        log.info("  ↩ TTS já existe: %s", out_path.name)
        return True

    if not ELEVENLABS_API_KEY:
        log.warning("  ⚠ ELEVENLABS_API_KEY não definida — pulando TTS")
        return False

    vo = scene["voiceover"]
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vo['voice_id']}"
    payload = {
        "text": vo["script"],
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability":        vo.get("stability", 0.82),
            "similarity_boost": vo.get("similarity_boost", 0.77),
            "style":            vo.get("style", 0.20),
            "use_speaker_boost": True,
        },
    }
    resp = requests.post(
        url, json=payload,
        headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
        timeout=60,
    )
    if resp.status_code != 200:
        log.error("  ✗ ElevenLabs HTTP %s: %s", resp.status_code, resp.text[:200])
        return False

    out_path.write_bytes(resp.content)
    log.info("  ✅ TTS salvo: %s", out_path.name)
    return True


# ── F — Pipeline de composição ────────────────────────────────────────────────

def _run(cmd: list[str], label: str) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou [{label}]:\n{result.stderr[-600:]}")


def _pil_text_frame(text: str, style_key: str, w: int = 1080) -> "Image.Image":
    """Renderiza uma pill de texto via PIL (sem dependência de libfreetype no ffmpeg)."""
    from PIL import ImageDraw, ImageFont

    st       = TEXT_STYLES[style_key]
    fs       = st["fontsize"]
    accent   = st["accent"]
    padding  = (20, 32)  # vertical, horizontal

    # Fonte — tenta Impact (macOS) depois DejaVu
    font_paths = [
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/opt/homebrew/share/fonts/dejavu-fonts/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    font = None
    for fp in font_paths:
        if Path(fp).exists():
            try:
                font = ImageFont.truetype(fp, fs)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    # Mede texto
    dummy = Image.new("RGBA", (1, 1))
    draw  = ImageDraw.Draw(dummy)
    bbox  = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    from PIL import ImageFilter

    pill_w  = tw + padding[1] * 2
    pill_h  = th + padding[0] * 2
    radius  = 22
    margin  = 26                       # espaço p/ sombra suave em volta da pill
    cw      = pill_w + margin * 2
    ch      = pill_h + margin * 2

    # Sombra suave — dá profundidade discreta, profissional
    shadow = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [margin, margin + 4, margin + pill_w, margin + pill_h + 4],
        radius=radius, fill=(0, 0, 0, 130),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))

    # Pill — verde da marca, levemente translúcida p/ conectar com o fundo
    pill = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d    = ImageDraw.Draw(pill)
    box  = [margin, margin, margin + pill_w, margin + pill_h]
    d.rounded_rectangle(box, radius=radius, fill=(27, 67, 50, 220))   # #1B4332 @ 86%

    if accent:                          # CTA — contorno dourado completo
        d.rounded_rectangle(box, radius=radius, outline=(212, 175, 55, 255), width=3)
    else:                               # demais — fino traço dourado na base
        d.rounded_rectangle(box, radius=radius, outline=(212, 175, 55, 110), width=2)

    d.text((margin + padding[1], margin + padding[0]), text, font=font,
           fill=(255, 255, 255, 255))

    pill = Image.alpha_composite(shadow, pill)

    # Centraliza numa faixa de largura w
    frame = Image.new("RGBA", (w, ch), (0, 0, 0, 0))
    frame.paste(pill, ((w - cw) // 2, 0), pill)
    return frame


def _add_text_overlays_moviepy(video_path: Path, overlays: list[dict], dur: float, out_path: Path) -> None:
    """Usa moviepy para compositar text pills frame-a-frame."""
    import moviepy as mp
    from moviepy import VideoFileClip, ImageClip, CompositeVideoClip

    base = VideoFileClip(str(video_path))

    clips: list[Any] = [base]
    for ov in overlays:
        start = float(ov["start"])
        end   = min(float(ov["end"]), dur)
        y_pos = 180 if ov["pos"] == "top" else 1500

        pill_img = _pil_text_frame(ov["text"], ov["style"])
        pill_np  = __import__("numpy").array(pill_img)

        pill_clip = (
            ImageClip(pill_np)
            .with_start(start)
            .with_end(end)
            .with_position(("center", y_pos))
            .with_effects([mp.video.fx.CrossFadeIn(0.3), mp.video.fx.CrossFadeOut(0.3)])
        )
        clips.append(pill_clip)

    comp = CompositeVideoClip(clips, size=(1080, 1920))
    comp.write_videofile(
        str(out_path),
        codec="libx264", audio_codec="aac",
        fps=30, preset="fast", logger=None,
    )
    base.close()
    comp.close()


def _boomerang(raw_video: Path) -> Path:
    """
    Versão bumerangue do clipe bruto: vídeo seguido dele mesmo invertido.
    Garante um loop perfeitamente contínuo (vai-e-volta) para o giro de câmera,
    sem emenda perceptível ao repetir. Mantido em cache no _tmp.
    """
    out = raw_video.parent / f"boom_{raw_video.stem}.mp4"
    if out.exists():
        return out
    cmd = [
        FFMPEG, "-y", "-i", str(raw_video),
        "-filter_complex",
        "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]",
        "-map", "[v]", "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-r", "30",
        str(out),
    ]
    _run(cmd, f"bumerangue {raw_video.name}")
    return out


def _probe_duration(path: Path) -> float:
    """Duração em segundos de um arquivo de mídia via ffprobe."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def compor_final(
    raw_video: Path,
    tts_audio: Path | None,
    music_path: Path | None,
    scene: dict,
    logo_512: Path,
    logo_still: Path,
    out_path: Path,
) -> bool:
    """
    Pipeline:
      1. ffmpeg — duração derivada do MP3: pré-roll + corpo (cobre toda a
         narração) + transição final para a logo; escala 1080×1920, watermark
         e mix de áudio → _mid.mp4
      2. moviepy — text overlays em PIL → final_*.mp4

    A duração de cada clipe = pré-roll + duração da narração + segura na logo.
    O vídeo bruto (Veo, 6-8 s) é repetido em loop para cobrir narrações longas.
    """
    is_logo = bool(scene.get("is_logo", False))
    music   = scene["music"]
    tmp     = out_path.parent / "_tmp"
    mid     = tmp / f"mid_{scene['label']}.mp4"
    wm      = WATERMARK

    has_vo  = bool(tts_audio and tts_audio.exists())
    has_mus = bool(music_path and music_path.exists())

    delay   = float(scene.get("start_delay", PRE_DELAY))
    vo_len  = _probe_duration(tts_audio) if has_vo else 0.0

    # Fonte do loop de vídeo:
    #  • produtos → versão bumerangue (vai-e-volta) p/ giro de câmera contínuo;
    #  • logo     → o próprio clipe, repetido em loop p/ cobrir a narração.
    loop_src = raw_video if is_logo else _boomerang(raw_video)
    raw_len  = _probe_duration(loop_src) or float(scene["duration_seconds"])

    if is_logo:
        # Abertura/fechamento: música entra após `delay`, narração começa em
        # LOGO_VO_START e o tema segura LOGO_TAIL após a narração.
        vo_start = float(scene["voiceover"].get("timing_start_sec", LOGO_VO_START))
        mus_delay = 1.0
        body  = vo_start + vo_len + LOGO_TAIL
        outro = 0.0
        xf    = 0.0
        body_end = body
        total    = body
    else:
        # Produto: pré-roll curto, narração logo após, transição final p/ logo.
        vo_start = delay + VO_OFFSET
        mus_delay = 1.0
        body  = max(vo_len + VO_OFFSET + 0.5, raw_len, 4.0)
        outro = OUTRO_DUR
        xf    = XFADE_DUR
        body_end = delay + body
        total    = body_end + outro - xf

    log.info("  → Duração: narração %.1fs (início %.1fs) · clipe %.1fs",
             vo_len, vo_start, total)

    # ── Entradas ─────────────────────────────────────────────────────────────
    inputs: list[str] = []
    # 0: vídeo bruto repetido em loop — produtos giram (câmera bumerangue) e a
    #    abertura/encerramento repete p/ acompanhar o tamanho da narração.
    inputs += ["-stream_loop", "12", "-i", str(loop_src)]
    # 1: watermark
    inputs += ["-i", str(logo_512)]
    idx = 2
    logo_idx = None
    if not is_logo:                          # 2: still da logo para o encerramento
        logo_idx = idx
        inputs += ["-loop", "1", "-i", str(logo_still)]
        idx += 1
    mus_idx = None
    if has_mus:
        mus_idx = idx
        inputs += ["-i", str(music_path)]
        idx += 1
    vo_idx = None
    if has_vo:
        vo_idx = idx
        inputs += ["-i", str(tts_audio)]
        idx += 1

    # ── Filtro de vídeo ──────────────────────────────────────────────────────
    pad_end = max(0.0, body - raw_len) + 2.0   # segura último frame se faltar
    fc = (
        f"[1:v]scale={wm['width_px']}:-1,format=rgba,"
        f"colorchannelmixer=aa={wm['opacity']}[wm];"
        f"[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#1B4332,fps=30,"
        f"tpad=start_duration={delay}:start_mode=clone:"
        f"stop_duration={pad_end}:stop_mode=clone,"
        f"trim=duration={body_end},setpts=PTS-STARTPTS[vbase];"
        f"[vbase][wm]overlay=x=W-w-{wm['margin_right_px']}:"
        f"y=H-h-{wm['margin_bottom_px']}[vbody]"
    )
    if is_logo:
        fc += ";[vbody]null[vout]"
    else:
        fc += (
            f";[{logo_idx}:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
            f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#1B4332,fps=30,"
            f"trim=duration={outro},setpts=PTS-STARTPTS[vlogo];"
            f"[vbody][vlogo]xfade=transition=fade:duration={xf}:"
            f"offset={body_end - xf}[vout]"
        )

    # ── Filtro de áudio ──────────────────────────────────────────────────────
    afc = ""
    audio_map: list[str] = []
    if has_mus:
        fi  = music["fade_in"]
        fo  = music["fade_out"]
        vdb = music["volume_db"]
        md  = int(mus_delay * 1000)               # delay da música (abertura/fim)
        afc += (
            f"[{mus_idx}:a]aresample=44100,volume={vdb}dB,"
            f"adelay={md}|{md},atrim=duration={total},"
            f"afade=t=in:st={mus_delay}:d={fi},"
            f"afade=t=out:st={max(0, total - fo)}:d={fo}[mus];"
        )
    if has_vo:
        vo_ms = int(vo_start * 1000)               # narração começa em vo_start
        afc += (
            f"[{vo_idx}:a]aresample=44100,"
            f"adelay={vo_ms}|{vo_ms},"
            f"apad=whole_dur={total},volume=8dB[voice];"
        )
    if has_mus and has_vo:
        afc += "[mus][voice]amix=inputs=2:duration=first:weights=1 2.2[aout]"
        audio_map = ["-map", "[aout]"]
    elif has_mus:
        afc = afc.rstrip(";").replace("[mus]", "[aout]")
        audio_map = ["-map", "[aout]"]
    elif has_vo:
        afc = afc.rstrip(";").replace("[voice]", "[aout]")
        audio_map = ["-map", "[aout]"]

    full_fc = fc + (";" + afc if afc else "")

    cmd = (
        [FFMPEG, "-y"]
        + inputs
        + ["-filter_complex", full_fc, "-map", "[vout]"]
        + audio_map
        + ["-c:v", "libx264", "-preset", "fast", "-crf", "18",
           "-c:a", "aac", "-b:a", "192k",
           "-r", "30", "-t", f"{total:.3f}", str(mid)]
    )

    try:
        _run(cmd, f"ffmpeg {scene['label']}")
    except RuntimeError as exc:
        log.error(str(exc))
        return False

    # ── Passo 2: moviepy — text overlays (timings ajustados à duração real) ──
    overlays = scene.get("overlay_text", [])
    adj: list[dict] = []
    for ov in overlays:
        o = dict(ov)
        if is_logo:                               # abertura/fechamento — tempos absolutos
            o["start"] = float(ov["start"])
            o["end"]   = min(float(ov["end"]), total - 0.1)
        elif ov["pos"] == "bottom":               # CTA — fixa no fim do corpo
            o["start"] = max(delay + 1.0, body_end - 2.4)
            o["end"]   = body_end
        else:                                     # demais — deslocadas pelo pré-roll
            o["start"] = float(ov["start"]) + delay
            o["end"]   = min(float(ov["end"]) + delay, body_end - 0.3)
        if o["end"] > o["start"] + 0.4:
            adj.append(o)

    if adj:
        log.info("  → Adicionando %d overlays de texto…", len(adj))
        try:
            _add_text_overlays_moviepy(mid, adj, total, out_path)
        except Exception as exc:
            log.error("moviepy falhou: %s — exportando sem texto.", exc)
            import shutil
            shutil.copy(mid, out_path)
    else:
        import shutil
        shutil.copy(mid, out_path)

    log.info("  ✅ Final: %s (%.1f MB)", out_path.name, out_path.stat().st_size / 1e6)
    return True


# ── H — Validação de pré-requisitos ──────────────────────────────────────────

def validar_cena(scene: dict) -> list[str]:
    erros = []
    img = scene.get("image_path", "")
    if scene["mode"] == "image" and img and not Path(img).exists():
        erros.append(f"Imagem não encontrada: {img}")
    return erros


# ── G — Concatenação e trilha contínua ───────────────────────────────────────

def concatenar_videos(clips: list[Path], out_path: Path) -> bool:
    """Concatena clipes (vídeo + narração, sem música) em um único arquivo."""
    if not clips:
        log.warning("Nenhum clipe para concatenar.")
        return False

    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    concat_list = tmp_dir / f"concat_{out_path.stem}.txt"
    with open(concat_list, "w") as f:
        for c in clips:
            f.write(f"file '{c.resolve()}'\n")

    cmd = [
        FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-r", "30",
        str(out_path),
    ]
    try:
        _run(cmd, "concatenar")
        return True
    except RuntimeError as exc:
        log.error(str(exc))
        return False


def _pick_music() -> Path | None:
    """Primeira trilha disponível em OUTPUT_DIR/music (track_*.mp3)."""
    mdir = OUTPUT_DIR / "music"
    tracks = sorted(mdir.glob("track_*.mp3"))
    if not tracks:
        log.warning("  ⚠ Nenhuma trilha em %s — vídeo final sem música.", mdir)
        return None
    return tracks[0]


def add_musica_continua(video_in: Path, music: Path | None, out_path: Path) -> bool:
    """
    Aplica UMA trilha contínua sobre o vídeo já montado — a música começa no
    segundo 1, atravessa todos os clipes sem corte e só faz fade no fim.
    A faixa de origem é repetida em loop p/ cobrir toda a duração.
    """
    import shutil
    total = _probe_duration(video_in)
    if not (music and music.exists()) or total <= 0:
        shutil.copy(video_in, out_path)
        return True

    afc = (
        f"[1:a]aresample=44100,volume=-21dB,"
        f"adelay=1000|1000,atrim=duration={total:.3f},"
        f"afade=t=in:st=1:d=1.0,"
        f"afade=t=out:st={max(0.0, total - 1.6):.3f}:d=1.6[mus];"
        f"[0:a][mus]amix=inputs=2:duration=first:weights=2.4 1[aout]"
    )
    cmd = [
        FFMPEG, "-y",
        "-i", str(video_in),
        "-stream_loop", "-1", "-i", str(music),
        "-filter_complex", afc,
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", f"{total:.3f}",
        str(out_path),
    ]
    try:
        _run(cmd, f"trilha contínua → {out_path.name}")
        return True
    except RuntimeError as exc:
        log.error(str(exc))
        shutil.copy(video_in, out_path)
        return False


def montar_completo(scenes: list[dict], finals: list[Path], music: Path | None) -> None:
    """Concatena as 6 partes e aplica a trilha contínua → COMERCIAL_APP_COMPLETO.mp4."""
    tmp = OUTPUT_DIR / "_tmp"
    nomus = tmp / "completo_nomus.mp4"
    completo = OUTPUT_DIR / "COMERCIAL_APP_COMPLETO.mp4"
    log.info("→ Montando vídeo completo (%d partes)…", len(finals))
    if not concatenar_videos(finals, nomus):
        return
    add_musica_continua(nomus, music, completo)
    log.info("🎬 Vídeo completo: %s (%.1f MB)",
             completo.name, completo.stat().st_size / 1e6)


def gerar_cortes_produto(scenes: list[dict], music: Path | None) -> None:
    """
    A partir das partes prontas, monta um corte por produto (abertura + produto
    + encerramento) com a mesma trilha contínua sem corte. Cada corte é um reel.
    """
    abertura = OUTPUT_DIR / f"final_{scenes[0]['label']}.mp4"
    encerr   = OUTPUT_DIR / f"final_{scenes[-1]['label']}.mp4"
    if not (abertura.exists() and encerr.exists()):
        log.warning("Cortes por produto: abertura/encerramento ausentes — pulando.")
        return

    cortes_dir = OUTPUT_DIR / "cortes_produto"
    cortes_dir.mkdir(exist_ok=True)
    tmp = OUTPUT_DIR / "_tmp"

    for s in scenes:
        if s.get("is_logo"):
            continue
        prod = OUTPUT_DIR / f"final_{s['label']}.mp4"
        if not prod.exists():
            continue
        out = cortes_dir / f"corte_{s['label']}.mp4"
        log.info("→ Corte de produto: %s", out.name)
        nomus = tmp / f"corte_nomus_{s['label']}.mp4"
        if concatenar_videos([abertura, prod, encerr], nomus):
            add_musica_continua(nomus, music, out)


# ── Etapas ────────────────────────────────────────────────────────────────────

def etapa_audios(scenes: list[dict], tmp: Path) -> None:
    """Gera apenas as narrações TTS que ainda não existem."""
    for i, s in enumerate(scenes, 1):
        log.info("[%d/%d] narração %s", i, len(scenes), s["label"])
        gerar_tts(s, tmp / f"vo_{s['label']}.mp3")


def etapa_brutos(scenes: list[dict], tmp: Path) -> None:
    """Gera apenas os vídeos brutos (Veo) que ainda não existem."""
    for i, s in enumerate(scenes, 1):
        log.info("[%d/%d] vídeo bruto %s", i, len(scenes), s["label"])
        if validar_cena(s):
            log.error("  ✗ Referência ausente — pulando.")
            continue
        gerar_video_bruto(s, tmp / f"raw_{s['label']}.mp4")


def etapa_finais(scenes: list[dict], tmp: Path, logo_512: Path, ref_abertura: Path) -> int:
    """
    Compõe os clipes finais (vídeo + narração, sem música). Gera o que faltar de
    bruto/áudio antes. Clipe final que já exista é mantido — só os ausentes.
    """
    ok = 0
    for i, scene in enumerate(scenes, 1):
        label = scene["label"]
        log.info("[%d/%d] %s", i, len(scenes), label)

        final_path = OUTPUT_DIR / f"final_{label}.mp4"
        if final_path.exists():
            log.info("  ↩  Clipe final já existe — pulando.")
            ok += 1
            continue

        erros = validar_cena(scene)
        if erros:
            for e in erros:
                log.error("  ✗ %s", e)
            continue

        raw_path = tmp / f"raw_{label}.mp4"
        tts_path = tmp / f"vo_{label}.mp3"

        log.info("  → Vídeo bruto (Veo 2)…")
        if not gerar_video_bruto(scene, raw_path):
            log.error("  ✗ Falha na geração de vídeo — pulando cena.")
            continue

        log.info("  → Narração TTS…")
        tts_ok = gerar_tts(scene, tts_path)

        # Música NÃO é embutida aqui — entra como trilha contínua na montagem.
        log.info("  → Compondo clipe final…")
        if compor_final(
            raw_video  = raw_path,
            tts_audio  = tts_path if tts_ok else None,
            music_path = None,
            scene      = scene,
            logo_512   = logo_512,
            logo_still = ref_abertura,
            out_path   = final_path,
        ):
            ok += 1
        log.info("")
    return ok


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Gerador de Reels — APP Agro Peças Padrão",
    )
    p.add_argument(
        "etapa", nargs="?", default="tudo",
        choices=["refs", "audios", "brutos", "finais", "completo", "tudo"],
        help="refs: só imagens de referência | audios: só narrações | "
             "brutos: só vídeos brutos (Veo) | finais: clipes finais | "
             "completo: clipes finais + vídeo completo + cortes | "
             "tudo: pipeline inteiro (padrão)",
    )
    return p.parse_args()


def main() -> None:
    args  = parse_args()
    etapa = args.etapa

    log.info("🎬  APP Agro Peças Padrão — Gerador de Reels")
    log.info("    Projeto GCP : %s", GCP_PROJECT)
    log.info("    Output      : %s", OUTPUT_DIR)
    log.info("    Etapa       : %s", etapa)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT_DIR / "_tmp"
    tmp.mkdir(exist_ok=True)

    # Pré-processamento da logo e dos fundos compositados (reaproveita o cache)
    logo_512     = prep_logo(LOGO_SRC)
    ref_abertura = prep_logo_on_bg(LOGO_SRC, BG_ABERTURA)

    scenes = build_scenes(ref_abertura)   # gera/reaproveita as referências
    log.info("    ElevenLabs  : %s",
             "✅ configurado" if ELEVENLABS_API_KEY else "⚠ não configurado")
    log.info("")

    if etapa == "refs":
        log.info("✅ Imagens de referência prontas em: %s", tmp)
        return

    if etapa == "audios":
        etapa_audios(scenes, tmp)
        log.info("✅ Narrações prontas em: %s", tmp)
        return

    if etapa == "brutos":
        etapa_brutos(scenes, tmp)
        log.info("✅ Vídeos brutos prontos em: %s", tmp)
        return

    # finais / completo / tudo → compõe os clipes finais
    ok = etapa_finais(scenes, tmp, logo_512, ref_abertura)

    log.info("━" * 54)
    log.info("✅  %d/%d clipes finais em: %s", ok, len(scenes), OUTPUT_DIR)

    if etapa == "finais":
        return

    # completo / tudo → vídeo completo + cortes, com trilha contínua sem corte
    finals  = [OUTPUT_DIR / f"final_{s['label']}.mp4" for s in scenes]
    prontos = [p for p in finals if p.exists()]
    if len(prontos) != len(scenes):
        log.warning("Vídeo completo aguardando: %d/%d clipes prontos.",
                    len(prontos), len(scenes))
        return

    music = _pick_music()
    montar_completo(scenes, finals, music)
    log.info("→ Gerando cortes individuais por produto…")
    gerar_cortes_produto(scenes, music)

    log.info("━" * 54)
    completo = OUTPUT_DIR / "COMERCIAL_APP_COMPLETO.mp4"
    if completo.exists():
        log.info("🎬  Vídeo completo: %s", completo.name)
        log.info("✂️   Cortes por produto: %s", OUTPUT_DIR / "cortes_produto")


if __name__ == "__main__":
    main()
