"""Derive the public Skittlez Plus Signature assets from the approved Skittle Plus assets.

Only the product name is replaced. Historical inputs are read-only. Requires
pypdf, Pillow, and Poppler's pdftoppm in the local asset-production environment.
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from subprocess import run
from tempfile import TemporaryDirectory

from PIL import Image, ImageChops
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject


ROOT = Path(__file__).resolve().parents[1]
PDF_OLD = ROOT / "public/fiches-produits/skittle-plus/verdanza-skittle-plus-signature-v1.pdf"
PDF_NEW = ROOT / "public/fiches-produits/skittlez-plus/verdanza-skittlez-plus-signature-v1.pdf"
IMAGE_ROOT = ROOT / "public/images/fiches-produits/signature-v1"
EXPECTED = {
    "pdf": "6e37d5d14d4413d198a81a174ab3585769ccf47187cdc0933eb5fa986efc69df",
    320: "bd48175764a414d72c58152373d2537ece49e0d7087c936732e59a5b4ee36519",
    640: "fec148f2e0c610b9ebd7b734e13a2334ac097502902ce92b47c27d9abf14286f",
}


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def replace_pdf_name() -> None:
    assert digest(PDF_OLD) == EXPECTED["pdf"], "Approved PDF source changed"
    reader = PdfReader(PDF_OLD)
    assert len(reader.pages) == 2
    writer = PdfWriter()
    writer.append(reader)
    for page in writer.pages:
        original = page.get_contents().get_data()
        assert original.count(b"(Skittle Plus)") == 1
        updated = original.replace(b"(Skittle Plus)", b"(Skittlez Plus)")
        stream = DecodedStreamObject()
        stream.set_data(updated)
        page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_metadata({
        key: value.replace("Skittle Plus", "Skittlez Plus") if isinstance(value, str) else value
        for key, value in reader.metadata.items()
    })
    PDF_NEW.parent.mkdir(parents=True, exist_ok=True)
    with PDF_NEW.open("wb") as output:
        writer.write(output)
    updated_reader = PdfReader(PDF_NEW)
    assert all("Skittlez Plus" in page.extract_text() and "Skittle Plus" not in page.extract_text() for page in updated_reader.pages)


def replace_preview_name(width: int, temporary: Path) -> None:
    old = IMAGE_ROOT / f"skittle-plus-signature-v1-{width}.webp"
    new = IMAGE_ROOT / f"skittlez-plus-signature-v1-{width}.webp"
    assert digest(old) == EXPECTED[width], f"Approved {width}px preview source changed"
    dpi = 180 if width == 640 else 90
    prefix = temporary / f"skittlez-{width}"
    run(["pdftoppm", "-f", "1", "-l", "1", "-r", str(dpi), "-png", "-singlefile", str(PDF_NEW), str(prefix)], check=True)
    with Image.open(old) as source, Image.open(prefix.with_suffix(".png")) as rendered:
        result = source.convert("RGB")
        # The approved WebP and PDF share typography. The crop maps only the
        # title glyphs from the corrected PDF into the original WebP title area.
        if width == 640:
            source_box, destination, scale = (100, 164, 525, 236), (60, 553), 0.99
        else:
            source_box, destination, scale = (50, 82, 263, 119), (31, 277), 0.985
        patch = rendered.convert("RGB").crop(source_box)
        patch = patch.resize((round(patch.width * scale), patch.height), Image.Resampling.LANCZOS)
        x, y = destination
        result.paste((250, 248, 242), (x, y, x + patch.width, y + patch.height))
        result.paste(patch, destination)
        new.parent.mkdir(parents=True, exist_ok=True)
        result.save(new, "WEBP", lossless=True, method=6)
    with Image.open(old) as old_image, Image.open(new) as new_image:
        difference = ImageChops.difference(old_image.convert("RGB"), new_image.convert("RGB"))
        assert difference.getbbox() is not None
        bounds = difference.getbbox()
        assert bounds[0] >= x and bounds[1] >= y and bounds[2] <= x + patch.width and bounds[3] <= y + patch.height, bounds


def main() -> None:
    replace_pdf_name()
    with TemporaryDirectory(prefix="verdanza-skittlez-signature-") as path:
        for width in (320, 640):
            replace_preview_name(width, Path(path))
    for path in (PDF_NEW, *(IMAGE_ROOT / f"skittlez-plus-signature-v1-{width}.webp" for width in (320, 640))):
        print(f"{digest(path)}  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
