#!/usr/bin/env python3
"""Monta Reels 1080x1920 (9:16) a partir de fotos de produto + texto, com zoom lento e música.
Uso: python3 build_reel.py spec.json
spec = {"out": "x.mp4", "scenes": [{"img": "src/a.png", "eyebrow": "...", "title": "...", "lines": ["..",".."], "cta": false}, ...]}
"""
import json, os, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1920
GREEN = (27, 67, 50); GREEN_D = (21, 54, 40); GOLD = (212, 175, 55); WHITE = (255, 255, 255); STONE = (236, 234, 226)
F_DISPLAY = os.path.join(HERE, "fonts/BarlowCondensed-ExtraBold.ttf")
F_BOLD = os.path.join(HERE, "fonts/BarlowCondensed-Bold.ttf")
F_BODY = os.path.join(HERE, "fonts/Barlow-Medium.ttf")
LOGO = os.path.expanduser("~/Documents/DEV/shopify-agro-pecas-theme/assets/logo_app_branca.png")
MUSIC = os.path.expanduser("~/Documents/DEV/app_uteis/comercial_app_veo3/music/track_default.mp3")
SCENE_SEC = 4.0; FADE = 0.6; FPS = 30

def bg():
    im = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        c = tuple(int(GREEN[i] * (1 - t) + GREEN_D[i] * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # faixa dourada fina no topo
    d.rectangle([0, 0, W, 14], fill=GOLD)
    return im

def fit(img, box_w, box_h):
    img = img.convert("RGBA")
    r = min(box_w / img.width, box_h / img.height)
    return img.resize((int(img.width * r), int(img.height * r)), Image.LANCZOS)

def draw_wrapped(d, text, font, x, y, max_w, fill, line_gap=8, anchor_center=True):
    words = text.split(); lines = []; cur = ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= max_w: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    for ln in lines:
        tw = d.textlength(ln, font=font)
        px = (W - tw) / 2 if anchor_center else x
        d.text((px, y), ln, font=font, fill=fill)
        y += font.size + line_gap
    return y

def scene(spec, idx):
    im = bg(); d = ImageDraw.Draw(im)
    # produto em card branco
    card_top = 560 if not spec.get("cta") else 640
    card = Image.new("RGBA", (960, 960), (255, 255, 255, 255))
    prod = Image.open(spec["img"])
    prod = fit(prod, 880, 880)
    card.paste(prod, ((960 - prod.width) // 2, (960 - prod.height) // 2), prod)
    # sombra
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([60 + 10, card_top + 24, 60 + 960 + 10, card_top + 960 + 24], 28, fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(30)); im.paste(sh, (0, 0), sh)
    mask = Image.new("L", (960, 960), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, 960, 960], 28, fill=255)
    im.paste(card, (60, card_top), mask)
    d = ImageDraw.Draw(im)
    # eyebrow
    f_eye = ImageFont.truetype(F_BOLD, 44)
    eye = spec.get("eyebrow", "APP AGRO PEÇAS PADRÃO").upper()
    tw = d.textlength(eye, font=f_eye); d.text(((W - tw) / 2, 150), eye, font=f_eye, fill=GOLD)
    # título
    f_t = ImageFont.truetype(F_DISPLAY, 112 if len(spec["title"]) < 26 else 92)
    y = draw_wrapped(d, spec["title"].upper(), f_t, 0, 215, 980, WHITE, line_gap=-6)
    # linhas abaixo do card
    f_b = ImageFont.truetype(F_BODY, 46)
    y = card_top + 960 + 56
    for ln in spec.get("lines", []):
        tw = d.textlength(ln, font=f_b); d.text(((W - tw) / 2, y), ln, font=f_b, fill=STONE); y += 64
    # CTA / código
    if spec.get("cta"):
        f_c = ImageFont.truetype(F_DISPLAY, 78)
        btn = "CHAME NO WHATSAPP"
        tw = d.textlength(btn, font=f_c)
        d.rounded_rectangle([(W - tw) / 2 - 48, 1700, (W + tw) / 2 + 48, 1700 + 120], 20, fill=(37, 211, 102))
        d.text(((W - tw) / 2, 1716), btn, font=f_c, fill=WHITE)
    if spec.get("code"):
        f_m = ImageFont.truetype(F_BOLD, 40)
        code = "Cód. " + spec["code"]
        tw = d.textlength(code, font=f_m)
        d.rounded_rectangle([(W - tw) / 2 - 24, card_top + 960 - 84, (W + tw) / 2 + 24, card_top + 960 - 16], 12, fill=GREEN_D)
        d.text(((W - tw) / 2, card_top + 960 - 72), code, font=f_m, fill=GOLD)
    # logo
    if os.path.exists(LOGO):
        lg = fit(Image.open(LOGO), 260, 90); im.paste(lg, (W - lg.width - 60, 40), lg)
    path = os.path.join(HERE, "frames", f"{spec['_name']}_{idx}.png"); os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path); return path

def build(spec):
    name = os.path.splitext(os.path.basename(spec["out"]))[0]
    pngs = []
    for i, s in enumerate(spec["scenes"]):
        s["_name"] = name; pngs.append(scene(s, i))
    n = len(pngs); frames = int(SCENE_SEC * FPS)
    inputs = []; filters = []
    for i, p in enumerate(pngs):
        inputs += ["-loop", "1", "-t", str(SCENE_SEC), "-i", p]
        zoom = f"zoompan=z='min(zoom+0.0009,1.10)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}" if i % 2 == 0 else \
               f"zoompan=z='if(eq(on,1),1.10,max(zoom-0.0009,1.0))':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}"
        filters.append(f"[{i}:v]{zoom},format=yuv420p[v{i}]")
    # xfade em cadeia
    last = "v0"; off = SCENE_SEC - FADE
    for i in range(1, n):
        out = f"x{i}" if i < n - 1 else "vout"
        filters.append(f"[{last}][v{i}]xfade=transition=fade:duration={FADE}:offset={off:.2f}[{out}]")
        last = out; off += SCENE_SEC - FADE
    total = SCENE_SEC * n - FADE * (n - 1)
    inputs += ["-i", MUSIC]
    filters.append(f"[{n}:a]atrim=0:{total:.2f},afade=t=in:st=0:d=1,afade=t=out:st={total-1.5:.2f}:d=1.5,volume=0.9[aout]")
    cmd = ["ffmpeg", "-y", "-v", "error"] + inputs + ["-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", str(FPS), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", spec["out"]]
    subprocess.run(cmd, check=True)
    print("ok", spec["out"], f"{total:.1f}s")

if __name__ == "__main__":
    for f in sys.argv[1:]:
        build(json.load(open(f)))
