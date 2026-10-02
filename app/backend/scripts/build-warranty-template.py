"""
Monta o modelo do "Manual de uso e certificado de garantia" usado pelo sistema.

Entrada (em docs/):
  - CERTIFICADO GARANTIA.pptx  -> páginas do certificado e da declaração, em branco
  - CERTIFICADO GARANTIA .pdf  -> páginas fixas (capa, boas-vindas, cuidados, garantia, assistência, contracapa)

Saída (em app/backend/assets/garantia/): layout.json + imagens. O manual-base.pdf
(só as páginas fixas, sem dado de cliente) sai do build-warranty-base.js.

Só precisa rodar de novo quando a loja mudar o manual.
    python scripts/build-warranty-template.py && node scripts/build-warranty-base.js
"""
import io
import json
import os
import re
import shutil
import zipfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PPTX = os.path.join(ROOT, "..", "..", "docs", "CERTIFICADO GARANTIA.pptx")
OUT = os.path.join(ROOT, "assets", "garantia")
EMU = 12700
SLIDES = {"certificado": 6, "declaracao": 7}


def text_of(body):
    paragraphs = []
    for p in re.findall(r"<a:p>(.*?)</a:p>", body, re.S):
        line = "".join(re.findall(r"<a:t>([^<]*)</a:t>", p))
        line = line.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        paragraphs.append(line)
    return paragraphs


def ink(data):
    """Onde está o traço dentro da imagem (frações): linha de escrita e caixa do desenho."""
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    if im.width > 800 and im.height > 100:
        return {}
    alpha = im.split()[3].point(lambda v: 255 if v > 40 else 0)
    box = alpha.getbbox()
    if not box:
        return {}
    rows = [sum(1 for v in alpha.crop((0, r, im.width, r + 1)).getdata() if v) for r in range(im.height)]
    line = max(range(im.height), key=lambda r: rows[r])
    return {"line": round((line + 1) / im.height, 3), "box": [round(box[0] / im.width, 3), round(box[1] / im.height, 3), round(box[2] / im.width, 3), round(box[3] / im.height, 3)]}


def main():
    os.makedirs(OUT, exist_ok=True)
    z = zipfile.ZipFile(PPTX)
    layout = {}
    used = set()
    for name, n in SLIDES.items():
        xml = z.read(f"ppt/slides/slide{n}.xml").decode("utf-8")
        rels = z.read(f"ppt/slides/_rels/slide{n}.xml.rels").decode("utf-8")
        media = {}
        for tag in re.findall(r"<Relationship [^>]*/>", rels):
            media[re.search(r'Id="(rId\d+)"', tag).group(1)] = re.search(r'Target="([^"]+)"', tag).group(1).split("/")[-1]
        items = []
        for body in re.findall(r"<p:sp>(.*?)</p:sp>", xml, re.S):
            off = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"', body)
            x, y, w, h = (round(int(v) / EMU, 2) for v in off.groups())
            embed = re.search(r'r:embed="(rId\d+)"', body)
            if embed:
                f = media[embed.group(1)]
                used.add(f)
                item = {"t": "img", "f": f, "x": x, "y": y, "w": w, "h": h}
                item.update(ink(z.read(f"ppt/media/{f}")))
                items.append(item)
                continue
            lines = text_of(body)
            if not any(l.strip() for l in lines):
                continue
            color = re.search(r'<a:srgbClr val="(\w+)"', body)
            font = re.search(r'typeface="([^"]+)"', body)
            size = re.search(r' sz="(\d+)"', body)
            leading = re.search(r'<a:lnSpc><a:spcPts val="(\d+)"/>', body)
            spacing = re.search(r' spc="(-?\d+)"', body)
            items.append({
                "t": "txt", "x": x, "y": y, "w": w, "h": h,
                "lines": lines,
                "color": color.group(1) if color else "222222",
                "font": font.group(1) if font else "",
                "size": int(size.group(1)) / 100 if size else 12,
                "leading": int(leading.group(1)) / 100 if leading else None,
                "spc": int(spacing.group(1)) / 100 if spacing else 0,
                "align": "center" if 'algn="ctr"' in body else "left",
            })
        layout[name] = items
    for f in sorted(used):
        with z.open(f"ppt/media/{f}") as src, open(os.path.join(OUT, f), "wb") as dst:
            shutil.copyfileobj(src, dst)
    size = re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', z.read("ppt/presentation.xml").decode("utf-8"))
    layout["page"] = {"w": round(int(size.group(1)) / EMU, 2), "h": round(int(size.group(2)) / EMU, 2)}
    with open(os.path.join(OUT, "layout.json"), "w", encoding="utf-8") as fh:
        json.dump(layout, fh, ensure_ascii=False, indent=1)
    print("ok", {k: len(v) for k, v in layout.items() if k != "page"}, len(used), "imagens")


main()
