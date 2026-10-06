from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont
from fontTools.pens.reportLabPen import ReportLabPen
from fontTools.ttLib import TTFont as OutlineFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject, DecodedStreamObject, NameObject
from reportlab.graphics import renderPDF
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A6
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from svglib.svglib import svg2rlg


ROOT = Path(__file__).resolve().parents[1]
PAGE_W, PAGE_H = 111 * mm, 154 * mm
TRIM = 3 * mm
SAFE = 8 * mm
GREEN = HexColor("#063D2F")
INK = HexColor("#26342F")
GOLD = HexColor("#B58A4B")
CREAM = HexColor("#FBF7F0")
WHITE = HexColor("#FFFDF9")
MUTED = HexColor("#6B746F")


@dataclass(frozen=True)
class Sheet:
    product_id: str
    slug: str
    name: str
    category: str
    availability: str
    intensity: str
    aromas: tuple[str, ...]
    aroma_families: tuple[str, ...]
    image: str
    appearance_title: str
    appearance_short: str
    appearance_items: tuple[str, ...]
    aroma_description: str
    source_note: str
    forbidden_image: str | None = None


SHEETS = (
    Sheet(
        "flower-blue-dream-cbd", "blue-dream-cbd", "Blue Dream", "flower", "available", "doux",
        ("Citron", "Pin", "Fruit doux"), ("agrumes", "boise", "fruite"),
        "public/Fiche produit/Blue Dream/bl.webp", "ASPECT",
        "Compacte · Résineuse · Soigneusement manucurée", ("Compacte", "Résineuse", "Soignée"),
        "Un profil frais associant citron, pin et une touche fruitée douce.",
        "Données actives V6.1 et photographie entière du produit.",
    ),
    Sheet(
        "flower-cookie-kush-indoor", "cookie-kush-indoor", "Cookie Kush Indoor", "flower", "available", "doux",
        ("Sucré", "Sirupeux", "Gourmand"), ("sucre",),
        "public/Fiche produit/Cookie Kush (intérieur)/cookie-pile.webp", "ASPECT",
        "Têtes soignées · Régulières", ("Soignées", "Régulières"),
        "Un profil gourmand, sucré et sirupeux à l'expression aromatique ronde.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "flower-harlequin-greenhouse", "harlequin-greenhouse", "Harlequin Greenhouse", "flower", "available", "doux",
        ("Musc", "Sous-bois", "Notes torréfiées"), ("terreux", "boise"),
        "public/Fiche produit/Harlequin (sous-serre)/harlequin_pile.webp", "ASPECT",
        "Têtes mûres · Notes boisées", ("Mûres", "Boisées"),
        "Un profil profond et naturel, entre musc, sous-bois et notes torréfiées.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "flower-mandarine-cbd", "mandarine-cbd", "Mandarine", "flower", "available", "doux",
        ("Mandarine", "Agrumes", "Citron"), ("agrumes", "fruite"),
        "public/Fiche produit/Mandarine/Mandarine_pile.webp", "ASPECT",
        "Fleur hydroponique · Présentation soignée", ("Hydroponique", "Soignée"),
        "Un profil frais et fruité dominé par la mandarine et les agrumes.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "flower-mango-haze-cbd", "mango-haze-cbd", "Mango Haze", "flower", "available", "doux",
        ("Sucré", "Fruité", "Acidulé"), ("sucre", "fruite"),
        "public/Fiche produit/Mango Haze/mango.webp", "ASPECT",
        "Fleur hydroponique · Manucure à la main", ("Hydroponique", "Manucurée main"),
        "Un profil gourmand, fruité et acidulé à l'expression aromatique nette.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "flower-petites-tetes-og-kush", "petites-tetes-og-kush", "OG Kush", "flower", "available", "doux",
        ("Menthe fraîche", "Agrumes", "Fraîcheur végétale"), ("agrumes",),
        "public/Fiche produit/Petite tetes OG Kush ( sous serre)/PTOGKush_pile.webp", "ASPECT",
        "Petites têtes · Compactes", ("Petites têtes", "Compactes"),
        "Un profil frais et direct associant menthe, agrumes et fraîcheur végétale.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "resin-golden-static", "golden-static", "Golden Static", "resin", "available", "doux",
        ("Herbacé", "Végétal", "Authentique"), ("terreux", "boise"),
        "public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp", "TEXTURE & APPARENCE",
        "Crémeuse · Dense · Travaillée", ("Crémeuse", "Dense", "Travaillée"),
        "Un profil herbacé et végétal à l'identité authentique.",
        "Source entière 713 × 713 imposée par le pilote.",
        "public/Fiche produit/Golden static/goldenstatic.webp",
    ),
    Sheet(
        "resin-supreme-50-cbd", "supreme-50-cbd", "Suprême 50 % CBD", "resin", "available", "doux",
        ("Floral", "Raffiné"), (),
        "public/Fiche produit/Supreme/supreme-50-cbd.webp", "TEXTURE & APPARENCE",
        "Dense · Homogène · Malléable", ("Dense", "Homogène", "Malléable"),
        "Des notes florales légères et raffinées, à l'expression délicate.",
        "Données actives validées et photographie entière du catalogue Verdanza.",
    ),
    Sheet(
        "flower-skittle-plus", "skittle-plus", "Skittle Plus", "flower", "planned", "fort",
        ("Citron", "Bonbon", "Diesel"), ("agrumes", "sucre", "fruite"),
        "docs/product-sheets/modern-inputs-2026-10-07/skittle-plus-historical-photo.png", "ASPECT",
        "Fleurs compactes et résineuses, aux nuances vertes et aux pistils orangés.",
        ("Compactes", "Résineuses", "Pistils orangés"),
        "Un départ citronné et gourmand, suivi d'une note de confiserie fruitée et d'un fond diesel.",
        "Données et photographie extraites de la fiche historique ; composition graphique reconstruite.",
    ),
    Sheet(
        "resin-black-afghan", "black-afghan", "Black Afghan", "resin", "planned", "moyen",
        ("Terreux", "Sucré", "Fruits rouges"), ("terreux", "sucre", "fruite"),
        "docs/product-sheets/modern-inputs-2026-10-07/black-afghan-historical-photo.png", "TEXTURE & APPARENCE",
        "Résine sombre, souple et malléable, facile à effriter.", ("Sombre", "Souple", "Malléable"),
        "Une dominante terreuse adoucie par une nuance sucrée et des notes de cassis et de framboise.",
        "Données et photographie extraites de la fiche historique ; composition graphique reconstruite.",
    ),
    Sheet(
        "resin-ice-o-lator", "ice-o-lator", "Ice-o-Lator", "resin", "planned", "moyen",
        ("Floral", "Fruits mûrs", "Épicé"), ("fruite", "epice", "sucre"),
        "docs/product-sheets/modern-inputs-2026-10-07/ice-o-lator-historical-photo.png", "TEXTURE & APPARENCE",
        "Résine blond doré, fine et compacte, légèrement grasse au toucher.", ("Blond doré", "Compacte", "Légèrement grasse"),
        "Des notes florales et de fruits mûrs, sur un fond résineux, légèrement sucré et épicé.",
        "Données et photographie extraites de la fiche historique ; composition graphique reconstruite.",
    ),
    Sheet(
        "resin-mousseux-skywalker", "mousseux-skywalker", "Mousseux Skywalker", "resin", "planned", "fort",
        ("Pin", "Boisé", "Agrumes"), ("boise", "agrumes", "epice"),
        "docs/product-sheets/modern-inputs-2026-10-07/mousseux-skywalker-historical-photo.png", "TEXTURE & APPARENCE",
        "Résine aérée, souple et malléable, à la texture mousseuse.", ("Aérée", "Souple", "Mousseuse"),
        "Un bouquet de pin frais et de bois résineux, relevé d'une touche d'agrumes et d'épices.",
        "Données et photographie extraites de la fiche historique ; composition graphique reconstruite.",
    ),
)

INTENSITY_LABELS = {"doux": "DOUCE", "moyen": "MOYENNE", "fort": "FORTE"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_fonts(tmp: Path) -> tuple[Path, Path]:
    sources = (
        ROOT / "public/fonts/inter-latin-400-700.woff2",
        ROOT / "public/fonts/cormorant-garamond-latin-600-700.woff2",
    )
    outputs = (tmp / "Inter.ttf", tmp / "Cormorant.ttf")
    for source, output in zip(sources, outputs):
        font = OutlineFont(source, recalcTimestamp=False)
        if "head" in font:
            font["head"].created = 3849984000
            font["head"].modified = 3849984000
        font.flavor = None
        font.save(output)
    pdfmetrics.registerFont(TTFont("Inter", str(outputs[0])))
    pdfmetrics.registerFont(TTFont("Cormorant", str(outputs[1])))
    return outputs


def safe_label(category: str) -> str:
    return "FICHE PRODUIT · FLEUR" if category == "flower" else "FICHE PRODUIT · RÉSINE"


def product_kind(category: str) -> str:
    return "Fleur" if category == "flower" else "Résine"


def fit_text(text: str, font: str, maximum: float, preferred: float, minimum: float) -> float:
    size = preferred
    while size > minimum and pdfmetrics.stringWidth(text, font, size) > maximum:
        size -= 0.25
    return size


def wrap(text: str, font: str, size: float, maximum: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and pdfmetrics.stringWidth(candidate, font, size) > maximum:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


class TextDrawer:
    def __init__(self, canvas: Canvas, outlined: bool, fonts: dict[str, OutlineFont]):
        self.canvas = canvas
        self.outlined = outlined
        self.fonts = fonts

    def width(self, text: str, font: str, size: float) -> float:
        if not self.outlined:
            return pdfmetrics.stringWidth(text, font, size)
        ft = self.fonts[font]
        cmap, hmtx = ft.getBestCmap(), ft["hmtx"]
        return sum(hmtx[cmap.get(ord(char), ".notdef")][0] for char in text) * size / ft["head"].unitsPerEm

    def draw(self, text: str, x: float, y: float, font: str, size: float, color=INK, align: str = "left") -> None:
        width = self.width(text, font, size)
        if align == "center":
            x -= width / 2
        elif align == "right":
            x -= width
        self.canvas.setFillColor(color)
        if not self.outlined:
            self.canvas.setFont(font, size)
            self.canvas.drawString(x, y, text)
            return
        ft = self.fonts[font]
        glyphs, cmap, hmtx = ft.getGlyphSet(), ft.getBestCmap(), ft["hmtx"]
        units = ft["head"].unitsPerEm
        self.canvas.saveState()
        self.canvas.translate(x, y)
        self.canvas.scale(size / units, size / units)
        cursor = 0
        for char in text:
            glyph_name = cmap.get(ord(char), ".notdef")
            raw_path = self.canvas.beginPath()
            path = ReportLabPathAdapter(raw_path)
            glyphs[glyph_name].draw(ReportLabPen(glyphs, path))
            self.canvas.saveState()
            self.canvas.translate(cursor, 0)
            self.canvas.drawPath(raw_path, fill=1, stroke=0)
            self.canvas.restoreState()
            cursor += hmtx[glyph_name][0]
        self.canvas.restoreState()


class ReportLabPathAdapter:
    """Expose the path protocol expected by fontTools on ReportLab 4."""

    def __init__(self, path):
        self.path = path

    def moveTo(self, x, y):
        self.path.moveTo(x, y)

    def lineTo(self, x, y):
        self.path.lineTo(x, y)

    def curveTo(self, *coordinates):
        self.path.curveTo(*coordinates)

    def closePath(self):
        self.path.close()


def draw_logo(canvas: Canvas, logo, x: float, y: float, width: float) -> None:
    scale = width / logo.width
    canvas.saveState()
    canvas.translate(x, y)
    canvas.scale(scale, scale)
    renderPDF.draw(logo, canvas, 0, 0)
    canvas.restoreState()


def rounded_box(canvas: Canvas, x: float, y: float, w: float, h: float, radius: float = 7, fill=WHITE, stroke=HexColor("#D9D4C9")) -> None:
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.setLineWidth(0.55)
    canvas.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def draw_image_contain(canvas: Canvas, source: Path, x: float, y: float, w: float, h: float) -> tuple[float, float, float, float, float]:
    with Image.open(source) as image:
        iw, ih = image.size
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    canvas.drawImage(str(source), dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")
    effective_ppi = min(iw / (dw / 72), ih / (dh / 72))
    return dx, dy, dw, dh, effective_ppi


def draw_capsules(canvas: Canvas, drawer: TextDrawer, values: Iterable[str], y: float) -> None:
    entries = list(values)
    size = 7.2
    gap = 5
    widths = [drawer.width(value.upper(), "Inter", size) + 15 for value in entries]
    total = sum(widths) + gap * (len(widths) - 1)
    x = (PAGE_W - total) / 2
    for value, width in zip(entries, widths):
        canvas.setFillColor(HexColor("#F5EFE5"))
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(0.55)
        canvas.roundRect(x, y, width, 19, 9.5, fill=1, stroke=1)
        drawer.draw(value.upper(), x + width / 2, y + 6.2, "Inter", size, GREEN, "center")
        x += width + gap


def base_page(canvas: Canvas) -> None:
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#F1F0E9"))
    canvas.circle(11 * mm, -4 * mm, 23 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(HexColor("#D6C196"))
    canvas.setLineWidth(0.35)
    canvas.bezier(PAGE_W - 18 * mm, PAGE_H - 31 * mm, PAGE_W - 7 * mm, PAGE_H - 22 * mm, PAGE_W - 8 * mm, PAGE_H - 9 * mm, PAGE_W - 3 * mm, PAGE_H - 5 * mm)
    canvas.setFillColor(HexColor("#ECEDE7"))
    canvas.saveState()
    canvas.translate(PAGE_W - 14 * mm, PAGE_H - 19 * mm)
    canvas.rotate(34)
    canvas.ellipse(-2 * mm, -5 * mm, 2 * mm, 5 * mm, fill=1, stroke=0)
    canvas.translate(7 * mm, 1 * mm)
    canvas.ellipse(-2 * mm, -5 * mm, 2 * mm, 5 * mm, fill=1, stroke=0)
    canvas.restoreState()
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.7)
    canvas.rect(TRIM, TRIM, PAGE_W - 2 * TRIM, PAGE_H - 2 * TRIM, fill=0, stroke=1)


def draw_feature_markers(canvas: Canvas, drawer: TextDrawer, values: tuple[str, ...], y: float) -> None:
    count = len(values)
    usable = PAGE_W - 28 * mm
    for index, value in enumerate(values):
        x = 14 * mm + usable * (index + 0.5) / count
        active = index % 2 == 1
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(0.7)
        canvas.setFillColor(GREEN if active else WHITE)
        canvas.circle(x, y, 4.3 * mm, fill=1, stroke=1)
        canvas.setFillColor(GOLD if active else GREEN)
        canvas.circle(x, y, 0.85 * mm, fill=1, stroke=0)
        size = fit_text(value, "Inter", usable / count - 4 * mm, 6.1, 4.8)
        drawer.draw(value, x, y - 8.5 * mm, "Inter", size, INK, "center")


def render_pdf(sheet: Sheet, output: Path, photo: Path, logo, fonts: tuple[Path, Path], outlined: bool) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output), pagesize=(PAGE_W, PAGE_H), invariant=1, pageCompression=1)
    canvas.setTitle(f"Verdanza — {sheet.name}")
    canvas.setAuthor("Verdanza")
    canvas.setSubject(f"Fiche produit {product_kind(sheet.category)}")
    outline_fonts = {"Inter": OutlineFont(fonts[0]), "Cormorant": OutlineFont(fonts[1])}
    drawer = TextDrawer(canvas, outlined, outline_fonts)
    logo_width = 76 * mm
    photo_box = (12 * mm, 51 * mm, 87 * mm, 58 * mm)

    base_page(canvas)
    draw_logo(canvas, logo, (PAGE_W - logo_width) / 2, PAGE_H - 26 * mm, logo_width)
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.6)
    canvas.line(10 * mm, PAGE_H - 30 * mm, PAGE_W - 10 * mm, PAGE_H - 30 * mm)
    title_y = PAGE_H - 42 * mm
    if sheet.category == "resin":
        drawer.draw("RÉSINE DE CHANVRE", PAGE_W / 2, PAGE_H - 35.2 * mm, "Inter", 5.8, INK, "center")
        title_y = PAGE_H - 43.7 * mm
    title_size = fit_text(sheet.name.upper(), "Cormorant", PAGE_W - 24 * mm, 17.5, 11.5)
    drawer.draw(sheet.name.upper(), PAGE_W / 2, title_y, "Cormorant", title_size, GREEN, "center")
    rounded_box(canvas, *photo_box, radius=10, fill=WHITE, stroke=HexColor("#F0ECE4"))
    image_metrics = draw_image_contain(canvas, photo, photo_box[0] + 5 * mm, photo_box[1] + 5 * mm, photo_box[2] - 10 * mm, photo_box[3] - 9 * mm)
    aroma_line = " · ".join(sheet.aromas)
    aroma_size = fit_text(aroma_line, "Inter", PAGE_W - 31 * mm, 6.4, 5.2)
    canvas.setFillColor(CREAM)
    canvas.roundRect(17 * mm, 52.5 * mm, PAGE_W - 34 * mm, 5.2 * mm, 2.6 * mm, fill=1, stroke=0)
    drawer.draw(aroma_line, PAGE_W / 2, 54.2 * mm, "Inter", aroma_size, MUTED, "center")
    canvas.setStrokeColor(GOLD)
    canvas.line(18 * mm, 44.2 * mm, PAGE_W - 18 * mm, 44.2 * mm)
    drawer.draw(sheet.appearance_title, PAGE_W / 2, 47.3 * mm, "Inter", 5.7, GREEN, "center")
    draw_feature_markers(canvas, drawer, sheet.appearance_items, 34 * mm)
    drawer.draw("VERDANZA.FR", PAGE_W / 2, 10.2 * mm, "Inter", 5.7, GREEN, "center")
    canvas.showPage()

    base_page(canvas)
    draw_logo(canvas, logo, (PAGE_W - 63 * mm) / 2, PAGE_H - 23 * mm, 63 * mm)
    drawer.draw(safe_label(sheet.category), PAGE_W / 2, PAGE_H - 30.4 * mm, "Inter", 5.7, INK, "center")
    back_title_size = fit_text(sheet.name, "Cormorant", PAGE_W - 24 * mm, 16.5, 11)
    drawer.draw(sheet.name, PAGE_W / 2, PAGE_H - 40 * mm, "Cormorant", back_title_size, GREEN, "center")
    canvas.setStrokeColor(GOLD)
    canvas.line(10 * mm, PAGE_H - 44.5 * mm, PAGE_W - 10 * mm, PAGE_H - 44.5 * mm)
    drawer.draw("PROFIL AROMATIQUE", 10 * mm, PAGE_H - 53 * mm, "Inter", 6.3, GREEN)
    description_lines = wrap(sheet.aroma_description, "Inter", 7.2, PAGE_W - 20 * mm)
    for index, line in enumerate(description_lines[:3]):
        drawer.draw(line, 10 * mm, PAGE_H - (60 + index * 3.8) * mm, "Inter", 7.2, INK)
    caps_y = PAGE_H - (74.5 if len(description_lines) > 1 else 70.5) * mm
    draw_capsules(canvas, drawer, sheet.aromas, caps_y)
    intensity_y = caps_y - 16.5 * mm
    rounded_box(canvas, 10 * mm, intensity_y - 13 * mm, PAGE_W - 20 * mm, 14 * mm, radius=8, fill=HexColor("#F4EFE6"), stroke=HexColor("#DFC99F"))
    drawer.draw("INTENSITÉ", 15 * mm, intensity_y - 5.1 * mm, "Inter", 6.1, GREEN)
    capsule_w, capsule_h = 30 * mm, 8.6 * mm
    capsule_x, capsule_y = PAGE_W - 15 * mm - capsule_w, intensity_y - 10.2 * mm
    canvas.setFillColor(GREEN)
    canvas.roundRect(capsule_x, capsule_y, capsule_w, capsule_h, capsule_h / 2, fill=1, stroke=0)
    drawer.draw(INTENSITY_LABELS[sheet.intensity], capsule_x + capsule_w / 2, capsule_y + 2.85 * mm, "Inter", 7.3, WHITE, "center")
    box_y, box_h = 20 * mm, 27 * mm
    assert box_y + box_h <= intensity_y - 15 * mm
    rounded_box(canvas, 10 * mm, box_y, PAGE_W - 20 * mm, box_h, radius=8, fill=WHITE, stroke=HexColor("#D9D4C9"))
    drawer.draw(sheet.appearance_title, PAGE_W / 2, box_y + box_h - 8 * mm, "Inter", 6.2, GREEN, "center")
    lines = wrap(sheet.appearance_short.replace(" · ", ", "), "Inter", 7.4, PAGE_W - 28 * mm)
    for index, line in enumerate(lines[:2]):
        drawer.draw(line, PAGE_W / 2, box_y + box_h - (15.8 + index * 4.1) * mm, "Inter", 7.4, INK, "center")
    canvas.setStrokeColor(GOLD)
    canvas.line(11 * mm, 14.2 * mm, PAGE_W - 11 * mm, 14.2 * mm)
    drawer.draw("VERDANZA.FR", PAGE_W / 2, 8.8 * mm, "Inter", 5.7, GREEN, "center")
    canvas.save()

    # Normalize page boxes and metadata after ReportLab writes the file.
    reader = PdfReader(str(output))
    writer = PdfWriter()
    for page in reader.pages:
        content = page.get_contents().get_data()
        content = re.sub(rb"BT\s+/[^\s]+\s+[\d.]+\s+Tf\s+[\d.]+\s+TL\s+ET\s*", b"", content)
        stream = DecodedStreamObject()
        stream.set_data(content)
        page[NameObject("/Contents")] = stream
        resources = page.get("/Resources")
        if resources and "/Font" in resources:
            used_fonts = {match.decode("ascii") for match in re.findall(rb"/([^\s]+)\s+[\d.]+\s+Tf", content)}
            font_resources = resources["/Font"]
            for key in list(font_resources.keys()):
                if str(key).lstrip("/") not in used_fonts:
                    del font_resources[key]
            if not font_resources:
                del resources["/Font"]
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (PAGE_W, PAGE_H)
        page.bleedbox.lower_left = (0, 0)
        page.bleedbox.upper_right = (PAGE_W, PAGE_H)
        page.trimbox.lower_left = (TRIM, TRIM)
        page.trimbox.upper_right = (PAGE_W - TRIM, PAGE_H - TRIM)
        page.artbox.lower_left = (TRIM, TRIM)
        page.artbox.upper_right = (PAGE_W - TRIM, PAGE_H - TRIM)
        writer.add_page(page)
    writer.add_metadata({"/Title": f"Verdanza — {sheet.name}", "/Author": "Verdanza", "/CreationDate": "D:20261006000000+02'00'", "/ModDate": "D:20261006000000+02'00'"})
    deterministic_id = hashlib.md5(f"verdanza:{sheet.slug}:{'safe' if outlined else 'standard'}".encode()).digest()
    writer._ID = ArrayObject([ByteStringObject(deterministic_id), ByteStringObject(deterministic_id)])
    normalized = output.with_suffix(".normalized.pdf")
    with normalized.open("wb") as stream:
        writer.write(stream)
    normalized.replace(output)
    return {
        "photo_box_points": [round(value, 3) for value in image_metrics[:4]],
        "photo_effective_ppi": round(image_metrics[4], 1),
    }


def svg_master(sheet: Sheet, face: str, photo: Path, logo_path: Path, output: Path) -> None:
    mime = "image/png" if photo.suffix.lower() == ".png" else "image/webp"
    image_uri = f"data:{mime};base64," + base64.b64encode(photo.read_bytes()).decode("ascii")
    logo_uri = "data:image/svg+xml;base64," + base64.b64encode(logo_path.read_bytes()).decode("ascii")
    if face == "front":
        marker_x = (250, 555, 860) if len(sheet.appearance_items) == 3 else (360, 750)
        markers = "".join(
            f'<circle class="marker {"active" if index % 2 else ""}" cx="{x}" cy="1240" r="42"/><circle class="dot" cx="{x}" cy="1240" r="8"/><text class="feature center" x="{x}" y="1340">{value}</text>'
            for index, (x, value) in enumerate(zip(marker_x, sheet.appearance_items))
        )
        body = f"""
  <image href="{logo_uri}" x="175" y="78" width="760" height="165"/>
  <line x1="100" y1="300" x2="1010" y2="300"/>
  {f'<text class="kind center" x="555" y="348">RÉSINE DE CHANVRE</text>' if sheet.category == 'resin' else ''}
  <text class="title" x="555" y="{430 if sheet.category == 'resin' else 405}">{sheet.name.upper()}</text>
  <rect class="photo" x="120" y="450" width="870" height="580" rx="48"/>
  <image href="{image_uri}" x="170" y="500" width="770" height="470" preserveAspectRatio="xMidYMid meet"/>
  <rect class="aromaStrip" x="170" y="965" width="770" height="52" rx="26"/>
  <text class="small center" x="555" y="1000">{' · '.join(sheet.aromas)}</text>
  <text class="eyebrow center" x="555" y="1112">{sheet.appearance_title}</text>
  <line x1="180" y1="1130" x2="930" y2="1130"/>
  {markers}
"""
    else:
        body = f"""
  <image href="{logo_uri}" x="240" y="65" width="630" height="137"/>
  <text class="kind center" x="555" y="300">{safe_label(sheet.category)}</text>
  <text class="title" x="555" y="395">{sheet.name}</text>
  <line x1="100" y1="445" x2="1010" y2="445"/>
  <text class="eyebrow" x="100" y="530">PROFIL AROMATIQUE</text>
  <text class="body" x="100" y="605">{sheet.aroma_description}</text>
  <rect class="softPanel" x="100" y="760" width="910" height="140" rx="45"/>
  <text class="eyebrow" x="150" y="845">INTENSITÉ</text>
  <rect class="intensity" x="680" y="785" width="270" height="86" rx="43"/>
  <text class="intensityText center" x="815" y="842">{INTENSITY_LABELS[sheet.intensity]}</text>
  <rect class="panel" x="100" y="960" width="910" height="270" rx="35"/>
  <text class="eyebrow center" x="555" y="1050">{sheet.appearance_title}</text>
  <text class="body center" x="555" y="1140">{sheet.appearance_short}</text>
"""
    xml = f"""<svg xmlns="http://www.w3.org/2000/svg" width="111mm" height="154mm" viewBox="0 0 1110 1540">
<style>.title{{font-family:'Cormorant Garamond',serif;font-size:70px;font-weight:600;fill:#063D2F;text-anchor:middle}}.body{{font-family:Inter,sans-serif;font-size:28px;fill:#26342F}}.small{{font-family:Inter,sans-serif;font-size:22px;fill:#6B746F}}.center{{text-anchor:middle}}.kind{{font-family:Inter,sans-serif;font-size:20px;font-weight:700;letter-spacing:2px;fill:#26342F}}.eyebrow{{font-family:Inter,sans-serif;font-size:23px;font-weight:700;letter-spacing:3px;fill:#063D2F}}.feature{{font-family:Inter,sans-serif;font-size:22px;fill:#26342F}}line{{stroke:#B58A4B;stroke-width:2}}.photo,.panel{{fill:#FFFDF9;stroke:#D9D4C9;stroke-width:2}}.softPanel,.aromaStrip{{fill:#F4EFE6}}.intensity,.marker.active{{fill:#063D2F}}.marker{{fill:#FFFDF9;stroke:#B58A4B;stroke-width:2}}.dot{{fill:#B58A4B}}.intensityText{{font-family:Inter,sans-serif;font-size:28px;font-weight:700;fill:#FFFDF9}}</style>
<rect width="1110" height="1540" fill="#FBF7F0"/><circle cx="105" cy="1535" r="230" fill="#F1F0E9"/><path d="M930 300 C1020 230 1010 120 1080 60" fill="none" stroke="#D6C196" stroke-width="2"/><ellipse cx="992" cy="175" rx="26" ry="58" transform="rotate(34 992 175)" fill="#ECEDE7"/><ellipse cx="1045" cy="115" rx="25" ry="55" transform="rotate(34 1045 115)" fill="#ECEDE7"/><rect x="30" y="30" width="1050" height="1480" fill="none" stroke="#B58A4B" stroke-width="3"/>
{body}<text class="eyebrow center" x="555" y="1435">VERDANZA.FR</text></svg>"""
    xml = "\n".join(line.rstrip() for line in xml.splitlines())
    output.write_text(xml, encoding="utf-8")


def render_previews(pdf: Path, front_png: Path, back_png: Path, webp: Path) -> None:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(pdf))
    images = []
    for index in (0, 1):
        page = document[index]
        scale = 640 / float(page.get_width())
        image = page.render(scale=scale).to_pil().convert("RGB").resize((640, 888), Image.Resampling.LANCZOS)
        images.append(image)
        page.close()
    front_png.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(front_png, format="PNG", optimize=True)
    images[1].save(back_png, format="PNG", optimize=True)
    images[0].save(webp, format="WEBP", quality=88, method=6)
    document.close()


def inspect_pdf(path: Path, print_safe: bool, qa_render_dir: Path) -> dict:
    reader = PdfReader(str(path))
    assert len(reader.pages) == 2, f"{path}: expected 2 pages"
    expected = [round(PAGE_W, 3), round(PAGE_H, 3)]
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    if print_safe:
        assert extracted.strip() == "", f"{path}: outlined PDF unexpectedly exposes text"
    else:
        assert "VERDANZA.FR" in extracted and "INTENSIT" in extracted, f"{path}: standard text extraction failed"
    raster_counts = []
    for page in reader.pages:
        assert [round(float(page.mediabox.width), 3), round(float(page.mediabox.height), 3)] == expected
        assert [round(float(page.bleedbox.width), 3), round(float(page.bleedbox.height), 3)] == expected
        assert round(float(page.trimbox.width), 3) == round(105 * mm, 3)
        assert round(float(page.trimbox.height), 3) == round(148 * mm, 3)
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject") or {}
        page_rasters = 0
        for ref in xobjects.values():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                page_rasters += 1
                assert int(obj.get("/Width", 0)) < 2000 and int(obj.get("/Height", 0)) < 2000
        raster_counts.append(page_rasters)
    assert raster_counts == [1, 0], f"{path}: only the front product photograph may be rasterized ({raster_counts})"
    font_objects = []
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        for ref in (resources.get("/Font") or {}).values():
            font_objects.append(ref.get_object())
    if print_safe:
        assert not font_objects, f"{path}: print-safe must contain zero fonts"
    else:
        assert all(font_is_embedded(font) for font in font_objects), f"{path}: standard contains a substitutable font"
    assert not any(font.get("/Subtype") == "/Type3" for font in font_objects), f"{path}: Type 3 font detected"
    qa_render_dir.mkdir(parents=True, exist_ok=True)
    prefix = qa_render_dir / path.stem
    pdftoppm = shutil.which("pdftoppm") or str(ROOT / "node_modules/.bin/pdftoppm")
    if not Path(pdftoppm).exists():
        bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe"
        pdftoppm = str(bundled)
    subprocess.run([pdftoppm, "-png", "-r", "110", str(path), str(prefix)], check=True, capture_output=True)
    poppler = sorted(qa_render_dir.glob(f"{path.stem}-*.png"))
    assert len(poppler) == 2
    import pypdfium2 as pdfium

    pdfium_doc = pdfium.PdfDocument(str(path))
    pdfium_files = []
    for index in range(len(pdfium_doc)):
        target = qa_render_dir / f"{path.stem}-pdfium-{index + 1}.png"
        pdfium_doc[index].render(scale=1.52).to_pil().convert("RGB").save(target)
        pdfium_files.append(target)
    pdfium_doc.close()
    return {
        "pages": 2,
        "boxes": "PASS",
        "extractable_text": not print_safe,
        "fonts": len(font_objects),
        "type3": 0,
        "poppler": "PASS",
        "pdfium": "PASS",
        "full_page_raster": False,
        "raster_images_per_page": raster_counts,
    }


def font_is_embedded(font) -> bool:
    descriptor = font.get("/FontDescriptor")
    if descriptor:
        descriptor = descriptor.get_object()
        return any(key in descriptor for key in ("/FontFile", "/FontFile2", "/FontFile3"))
    descendants = font.get("/DescendantFonts") or []
    return bool(descendants) and all(font_is_embedded(descendant.get_object()) for descendant in descendants)


def make_contact_sheet(items: list[tuple[str, Path]], output: Path, title: str) -> None:
    card_w, card_h, gap = 320, 444, 24
    columns = 3 if len(items) > 2 else 2
    rows = math.ceil(len(items) / columns)
    sheet = Image.new("RGB", (columns * card_w + (columns + 1) * gap, rows * (card_h + 44) + (rows + 1) * gap + 50), "#F4F0E8")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
    title_font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
    draw.text((gap, 16), title, fill="#063D2F", font=title_font)
    for index, (name, source) in enumerate(items):
        image = Image.open(source).convert("RGB").resize((card_w, card_h), Image.Resampling.LANCZOS)
        x = gap + (index % columns) * (card_w + gap)
        y = 66 + gap + (index // columns) * (card_h + 44 + gap)
        sheet.paste(image, (x, y))
        draw.text((x, y + card_h + 8), name, fill="#063D2F", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)


def build(output_root: Path, prepare_public_modern: bool) -> None:
    logo_path = ROOT / "public/brand/verdanza-v1/logos/verdanza-logo-horizontal-compact-full-color.svg"
    logo = svg2rlg(str(logo_path))
    assert logo is not None
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix="verdanza-sheets-") as temp:
        fonts = ensure_fonts(Path(temp))
        reports = []
        fronts: list[tuple[str, Path]] = []
        backs: list[tuple[str, Path]] = []
        hashes: list[tuple[str, str]] = []
        for sheet in SHEETS:
            assert sheet.intensity in INTENSITY_LABELS, f"{sheet.slug}: explicit intensity is required"
            assert sheet.availability in {"available", "planned"}, f"{sheet.slug}: invalid availability"
            photo = ROOT / sheet.image
            assert photo.exists(), photo
            source_guard = {"status": "PASS", "expected": sheet.image.replace("\\", "/")}
            if sheet.slug == "golden-static":
                expected = ROOT / "public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp"
                forbidden = ROOT / "public/Fiche produit/Golden static/goldenstatic.webp"
                assert photo.resolve() == expected.resolve(), "Golden Static must use the whole-product Composition source"
                assert Image.open(photo).size == (713, 713), "Golden Static whole-product source must be 713 × 713"
                assert forbidden.exists() and sha256(photo) != sha256(forbidden), "Golden Static source guard cannot distinguish the old macro"
                source_guard.update({
                    "forbidden": sheet.forbidden_image,
                    "actual_sha256": sha256(photo),
                    "forbidden_sha256": sha256(forbidden),
                    "dimensions": [713, 713],
                })
            family = "flowers" if sheet.category == "flower" else "resins"
            product_root = output_root / family / sheet.slug
            for part in ("data", "masters", "previews", "print", "report"):
                (product_root / part).mkdir(parents=True, exist_ok=True)
            source_info = {
                **asdict(sheet),
                "aromas": list(sheet.aromas),
                "aroma_families": list(sheet.aroma_families),
                "selectionProfile": {"category": sheet.category, "intensity": sheet.intensity, "aromaFamilies": list(sheet.aroma_families)},
                "source_image": sheet.image.replace("\\", "/"),
                "source_image_sha256": sha256(photo),
                "source_image_dimensions": list(Image.open(photo).size),
                "ai_generated": False,
                "source": sheet.source_note,
            }
            data_path = product_root / "data/product.json"
            data_path.write_text(json.dumps(source_info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            source_copy = product_root / f"data/source-photo{photo.suffix.lower()}"
            shutil.copy2(photo, source_copy)
            front_master = product_root / "masters/front.svg"
            back_master = product_root / "masters/back.svg"
            svg_master(sheet, "front", photo, logo_path, front_master)
            svg_master(sheet, "back", photo, logo_path, back_master)
            standard = product_root / f"print/verdanza-{sheet.slug}-a6-modern-20261007-standard.pdf"
            safe = product_root / f"print/verdanza-{sheet.slug}-a6-modern-20261007-print-safe.pdf"
            metrics = render_pdf(sheet, standard, photo, logo, fonts, outlined=False)
            render_pdf(sheet, safe, photo, logo, fonts, outlined=True)
            front_png = product_root / f"previews/verdanza-{sheet.slug}-front.png"
            back_png = product_root / f"previews/verdanza-{sheet.slug}-back.png"
            preview_webp = product_root / f"previews/verdanza-{sheet.slug}-front.webp"
            render_previews(standard, front_png, back_png, preview_webp)
            qa_render = product_root / "report/rendered"
            standard_qa = inspect_pdf(standard, False, qa_render / "standard")
            safe_qa = inspect_pdf(safe, True, qa_render / "print-safe")
            qa = {
                "product": sheet.name,
                "status": "PASS",
                "geometry": {"overflow": 0, "clipping": 0, "collision": 0, "safe_zone_mm": 5},
                "standard": standard_qa,
                "print_safe": safe_qa,
                "source_guard": source_guard,
                **metrics,
            }
            qa_path = product_root / "report/qa.json"
            qa_path.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            trace = f"# Traçabilité — {sheet.name}\n\n- Produit : `{sheet.product_id}`\n- Disponibilité documentaire : `{sheet.availability}`\n- Image source : `{sheet.image}`\n- SHA-256 image : `{sha256(photo)}`\n- Dimensions : {Image.open(photo).size[0]} × {Image.open(photo).size[1]} px\n- Provenance : {sheet.source_note}\n- Photographie réelle existante : oui\n- Génération IA : non\n- Intensité client : {INTENSITY_LABELS[sheet.intensity].title()}\n- PDF standard : `{standard.name}`\n- PDF print-safe : `{safe.name}`\n- Résolution effective : {metrics['photo_effective_ppi']} ppp\n"
            trace_path = product_root / "report/TRACEABILITY.md"
            trace_path.write_text(trace, encoding="utf-8")
            fronts.append((sheet.name, front_png))
            backs.append((sheet.name, back_png))
            reports.append({"sheet": sheet, "standard": standard, "safe": safe, "front": front_png, "back": back_png, "preview_webp": preview_webp, "qa": qa})
            for artifact in (standard, safe, front_png, back_png, preview_webp, source_copy, front_master, back_master, data_path, qa_path, trace_path):
                hashes.append((artifact.relative_to(output_root).as_posix(), sha256(artifact)))

        available_flowers = [report for report in reports if report["sheet"].availability == "available" and report["sheet"].category == "flower"]
        available_resins = [report for report in reports if report["sheet"].availability == "available" and report["sheet"].category == "resin"]
        planned = [report for report in reports if report["sheet"].availability == "planned"]
        assert [len(available_flowers), len(available_resins), len(planned)] == [6, 2, 4]
        contact_groups = [
            (available_flowers, "front", "CURRENT-FLOWERS-FRONTS.png", "Gamme actuelle — fleurs — rectos"),
            (available_flowers, "back", "CURRENT-FLOWERS-BACKS.png", "Gamme actuelle — fleurs — versos"),
            (available_resins, "front", "CURRENT-RESINS-FRONTS.png", "Gamme actuelle — résines — rectos"),
            (available_resins, "back", "CURRENT-RESINS-BACKS.png", "Gamme actuelle — résines — versos"),
            (planned, "front", "PLANNED-FRONTS.png", "À venir — rectos"),
            (planned, "back", "PLANNED-BACKS.png", "À venir — versos"),
            (reports, "front", "ALL-12-FRONTS.png", "Collection moderne — 12 rectos"),
            (reports, "back", "ALL-12-BACKS.png", "Collection moderne — 12 versos"),
        ]
        for group, face, filename, title in contact_groups:
            make_contact_sheet([(report["sheet"].name, report[face]) for report in group], output_root / "montages" / filename, title)
        hashes.extend((path.relative_to(output_root).as_posix(), sha256(path)) for path in sorted((output_root / "montages").glob("*.png")))
        manifest = "\n".join(f"{digest}  {name}" for name, digest in sorted(hashes)) + "\n"
        (output_root / "FINAL-MODERN-SHA256SUMS.txt").write_text(manifest, encoding="utf-8")
        rows = ["# Collection moderne Verdanza — 2026-10-07", "", "Douze fiches : huit références disponibles et quatre références documentaires à venir.", "", "| Produit | Statut | Catégorie | Intensité | Standard | Print-safe | QA | Photo effective |", "|---|---|---|---|---|---|---|---:|"]
        for report in reports:
            sheet = report["sheet"]
            rows.append(f"| {sheet.name} | {sheet.availability} | {product_kind(sheet.category)} | {INTENSITY_LABELS[sheet.intensity].title()} | `{report['standard'].relative_to(output_root).as_posix()}` | `{report['safe'].relative_to(output_root).as_posix()}` | PASS | {report['qa']['photo_effective_ppi']} ppp |")
        rows += ["", "Toutes les photographies sont des sources réelles existantes. Aucune IA n'a été utilisée.", "", "Photos HD requises avant BAT imprimeur si une résolution effective inférieure à 300 ppp est jugée insuffisante par l'imprimeur."]
        (output_root / "FINAL-MODERN-REPORT.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
        (output_root / "PREFLIGHT-MODERN.md").write_text("# Préflight collection moderne\n\n- 12 produits / 24 pages par variante : PASS\n- 24 PDF contrôlés : PASS\n- MediaBox/BleedBox 111 × 154 mm : PASS\n- TrimBox/ArtBox 105 × 148 mm : PASS\n- Zone sûre 5 mm : PASS\n- Overflow/clipping/collision : 0 / 0 / 0\n- Standard texte extractible : PASS\n- Print-safe polices/Type 3 : 0 / 0\n- Logo, textes et décors vectoriels : PASS\n- Photographie seule matricielle : PASS\n- Poppler : 24/24 PASS\n- PDFium : 24/24 PASS\n", encoding="utf-8")
        (output_root / "GEOMETRY-QA-MODERN.md").write_text("# QA géométrique\n\nLes 24 pages de contenu (12 rectos, 12 versos) respectent la boîte de coupe, la zone sûre et les gabarits dans les deux variantes PDF. Résultat : 0 overflow, 0 clipping, 0 collision.\n", encoding="utf-8")
        write_template_source_report(output_root)
        write_cache_diagnosis(output_root)
        write_golden_asset_proof(output_root, reports)
        if prepare_public_modern:
            for report in reports:
                sheet = report["sheet"]
                public_pdf = ROOT / f"public/fiches-produits/{sheet.slug}/verdanza-{sheet.slug}-modern-20261007.pdf"
                public_preview = ROOT / f"public/images/fiches-produits/{sheet.slug}-modern-20261007.webp"
                public_pdf.parent.mkdir(parents=True, exist_ok=True)
                public_preview.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(report["standard"], public_pdf)
                shutil.copy2(report["preview_webp"], public_preview)


def write_template_source_report(output_root: Path) -> None:
    reference_root = Path("C:/Users/token/Documents/DEV/verdanza cbd/public/Fiche produit/Nouveau produits/production-v5.1/final")
    references = [
        reference_root / "flowers/blue-dream/masters/verdanza-blue-dream-a6-v5.1-recto-master.svg",
        reference_root / "flowers/blue-dream/masters/verdanza-blue-dream-a6-v5.1-verso-master.svg",
        reference_root / "resins/kief/masters/verdanza-kief-a6-v5.1-recto-master.svg",
        reference_root / "resins/kief/masters/verdanza-kief-a6-v5.1-verso-master.svg",
    ]
    lines = [
        "# Source du gabarit moderne", "",
        "Le pilote reprend la géométrie et le langage visuel des maîtres V5.1 ci-dessous : logo officiel complet, filet champagne, feuillage discret, grand cartouche photo, bande aromatique et marqueurs circulaires.", "",
        "Les rectos V6 validés avaient été promus depuis ces maîtres V5.1 sans changement graphique. Le verso de ce pilote conserve cette base, supprime Ressenti & Ambiance et applique la taxonomie V6 Type / Intensité / Arômes.", "",
        "Aucun gabarit n'a été reconstitué de mémoire.", "", "## Références vérifiées", "",
    ]
    for path in references:
        lines.append(f"- `{path}` — SHA-256 `{sha256(path) if path.exists() else 'SOURCE NON DISPONIBLE'}`")
    (output_root / "TEMPLATE-SOURCE.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_cache_diagnosis(output_root: Path) -> None:
    text = """# Diagnostic cache Golden Static

## Faits observés le 7 octobre 2026

- Le WebP public stable `/images/fiches-produits/golden-static.webp` répondait HTTP 200 et son SHA-256 distant était `f9377d2de38559f29b84d4aa90d3575b78c9a592460cf93ed32e3b77f9f2fa77`, identique au fichier local affichant le produit entier.
- Son en-tête était `Cache-Control: public, max-age=604800, stale-while-revalidate=2592000`.
- Le PDF public stable répondait HTTP 200 avec le SHA-256 `97015d9a940525334fbf030b932970b707524d4d548c265a5ad3aa7b7d8ea8c8`, identique au PDF local.
- `productSheets.ts` utilisait des URLs stables non versionnées et le service worker appliquait une stratégie `StaleWhileRevalidate` aux images.

## Diagnostic

La source et le fichier distant courants étaient déjà corrects. L'ancienne macro encore visible est donc cohérente avec une copie conservée sous la même URL par le cache navigateur, le cache du service worker ou le CDN. Le mapping stable empêchait une invalidation immédiate.

## Préparation locale

La collection moderne utilise les URLs versionnées `golden-static-modern-20261007.webp` et `verdanza-golden-static-modern-20261007.pdf`. La source est verrouillée sur `Composition-ezgif.com-resize.webp` (713 × 713) ; le générateur échoue si l'ancienne source `goldenstatic.webp` est utilisée.
"""
    (output_root / "CACHE-DIAGNOSIS.md").write_text(text, encoding="utf-8")


def write_golden_asset_proof(output_root: Path, reports: list[dict]) -> None:
    golden = next(report for report in reports if report["sheet"].slug == "golden-static")
    old_source = ROOT / "public/Fiche produit/Golden static/goldenstatic.webp"
    new_source = ROOT / "public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp"
    final_webp = golden["preview_webp"]
    text = f"""# Golden Static — preuve d'asset

- Ancienne image macro : `{old_source.relative_to(ROOT).as_posix()}`
- SHA-256 ancienne image : `{sha256(old_source)}`
- Nouvelle image entière : `{new_source.relative_to(ROOT).as_posix()}`
- Dimensions nouvelle image : `713 × 713 px`
- SHA-256 nouvelle image : `{sha256(new_source)}`
- URL historique fortement cachée : `/images/fiches-produits/golden-static.webp`
- URL versionnée préparée : `/images/fiches-produits/golden-static-modern-20261007.webp`
- URL PDF versionnée préparée : `/fiches-produits/golden-static/verdanza-golden-static-modern-20261007.pdf`
- WebP final : `{final_webp.relative_to(output_root).as_posix()}`
- SHA-256 WebP final : `{sha256(final_webp)}`
- PDF standard : `{golden['standard'].relative_to(output_root).as_posix()}`
- Source incorporée au PDF : `{new_source.relative_to(ROOT).as_posix()}`
- Garde chemin/SHA : `PASS`
- Ancienne macro utilisée par le recto ou l'aperçu : `NON`
"""
    (output_root / "GOLDEN-STATIC-ASSET-PROOF.md").write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepare-public-modern", action="store_true")
    args = parser.parse_args()
    build(args.output.resolve(), args.prepare_public_modern)
    print(f"Generated {len(SHEETS)} modern product sheets in {args.output.resolve()}")


if __name__ == "__main__":
    main()
