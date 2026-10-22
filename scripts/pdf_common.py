"""Shared layout for the PDF reports (reportlab): fonts, styles, tables, page footer.

Output is reproducible: reportlab runs in invariant mode (no creation date or
random document id), so the same data always gives the same PDF bytes.
"""
import json
import struct
import tempfile
import zlib
from pathlib import Path

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
from xml.sax.saxutils import escape

rl_config.invariant = 1

FONTS = Path(__file__).resolve().parent / 'fonts'
pdfmetrics.registerFont(TTFont('Sans', str(FONTS / 'LiberationSans-Regular.ttf')))
pdfmetrics.registerFont(TTFont('Sans-Bold', str(FONTS / 'LiberationSans-Bold.ttf')))
pdfmetrics.registerFont(TTFont('Sans-Italic', str(FONTS / 'LiberationSans-Italic.ttf')))
pdfmetrics.registerFont(TTFont('Mono', str(FONTS / 'LiberationMono-Regular.ttf')))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans-Italic', boldItalic='Sans-Bold')

BRAND = colors.HexColor('#124a40')
BRAND_SOFT = colors.HexColor('#e8f3ef')
INK = colors.HexColor('#1f2a27')
MUTED = colors.HexColor('#56635e')
LINE = colors.HexColor('#dcd8ce')
ZEBRA = colors.HexColor('#f8f5ef')
HEAD_BG = colors.HexColor('#efe7d6')
ROSE_BG = colors.HexColor('#fcefee')
ROSE_INK = colors.HexColor('#8a3530')
SKY_BG = colors.HexColor('#edf1f8')
SKY_INK = colors.HexColor('#2c3f66')
RED = colors.HexColor('#b42318')

_base = dict(fontName='Sans', textColor=INK)
S = {
    'title': ParagraphStyle('title', fontSize=19, leading=23, textColor=BRAND, fontName='Sans-Bold', spaceAfter=4),
    'subtitle': ParagraphStyle('subtitle', fontSize=10.5, leading=14, textColor=MUTED, fontName='Sans', spaceAfter=10),
    'h1': ParagraphStyle('h1', fontSize=14, leading=18, textColor=BRAND, fontName='Sans-Bold', spaceBefore=12, spaceAfter=6),
    'h2': ParagraphStyle('h2', fontSize=11.5, leading=15, textColor=INK, fontName='Sans-Bold', spaceBefore=9, spaceAfter=4),
    'h3': ParagraphStyle('h3', fontSize=9.5, leading=12, textColor=SKY_INK, fontName='Sans-Bold', spaceBefore=7, spaceAfter=3),
    'body': ParagraphStyle('body', fontSize=9.5, leading=13.5, spaceAfter=5, **_base),
    'small': ParagraphStyle('small', fontSize=8, leading=10.5, textColor=MUTED, fontName='Sans', spaceAfter=3),
    'cell': ParagraphStyle('cell', fontSize=8.3, leading=10.5, **_base),
    'cell_small': ParagraphStyle('cell_small', fontSize=7.4, leading=9.4, **_base),
    'cell_head': ParagraphStyle('cell_head', fontSize=8, leading=10, textColor=INK, fontName='Sans-Bold'),
    'cell_num': ParagraphStyle('cell_num', fontSize=8.3, leading=10.5, alignment=TA_RIGHT, **_base),
    'big': ParagraphStyle('big', fontSize=20, leading=23, textColor=BRAND, fontName='Sans-Bold'),
    'big_label': ParagraphStyle('big_label', fontSize=8.5, leading=11, textColor=MUTED, fontName='Sans'),
}
CONTENT_WIDTH = A4[0] - 36 * mm


def x(text):
    """Escape base text for a Paragraph."""
    return escape(str(text if text is not None else ''))


def P(text, style='body'):
    return Paragraph(text, S[style] if isinstance(style, str) else style)


def mask_proc(code):
    c = str(code)
    return f'{c[:2]}.{c[2:4]}.{c[4:6]}.{c[6:9]}-{c[9:]}' if len(c) == 10 and c.isdigit() else c


def mask_hab(code):
    return f'{code[:2]}.{code[2:]}' if len(code) == 4 and code.isdigit() else code


def comp_label(c):
    return f'{c[4:]}/{c[:4]}'


def fmt_int(n):
    return f'{n:,}'.replace(',', '.')


def money(v):
    return 'R$ ' + f'{v:,.2f}'.replace(',', '#').replace('.', ',').replace('#', '.')


def pct(part, whole):
    return f'{100 * part / whole:.1f}%'.replace('.', ',') if whole else '—'


def _png(size=64):
    """A red circle with an x (the site's "sem habilitação" mark), as a tiny PNG."""
    r, cx = size * 0.42, size / 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for xx in range(size):
            dx, dy = xx + 0.5 - cx, y + 0.5 - cx
            d = (dx * dx + dy * dy) ** 0.5
            on_ring = abs(d - r) < size * 0.055
            on_x = d < r * 0.62 and (abs(dx - dy) < size * 0.07 or abs(dx + dy) < size * 0.07)
            row += bytes((0xb4, 0x23, 0x18, 255)) if (on_ring or on_x) else bytes((255, 255, 255, 0))
        rows.append(bytes(row))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


_ICON = Path(tempfile.gettempdir()) / 'sigtap_nohab_icon.png'
_ICON.write_bytes(_png())
NOHAB = f'<img src="{_ICON}" width="7.5" height="7.5" valign="-1"/>'


def table(rows, widths, head=True, style='cell', zebra=True, extra=None, repeat=1):
    """rows: lists of strings (already escaped markup) or flowables."""
    data = []
    for i, row in enumerate(rows):
        st = 'cell_head' if head and i == 0 else style
        data.append([c if not isinstance(c, str) else P(c, st) for c in row])
    t = Table(data, colWidths=widths, repeatRows=repeat if head else 0, splitInRow=1)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
        ('BOX', (0, 0), (-1, -1), 0.5, LINE),
    ]
    if head:
        cmds += [('BACKGROUND', (0, 0), (-1, 0), HEAD_BG)]
    if zebra:
        for i in range(1 if head else 0, len(data)):
            if (i - (1 if head else 0)) % 2:
                cmds.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(cmds + (extra or [])))
    return t


def box(flowables, bg=SKY_BG, border=None):
    t = Table([[flowables]], colWidths=[CONTENT_WIDTH])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.5, border or bg),
                           ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
                           ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    return t


def numbers(items):
    """Row of big numbers: [(value, label), ...]."""
    w = CONTENT_WIDTH / len(items)
    t = Table([[[P(v, 'big'), P(label, 'big_label')] for v, label in items]], colWidths=[w] * len(items))
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0),
                           ('LINEBEFORE', (1, 0), (-1, -1), 0.5, LINE), ('LEFTPADDING', (1, 0), (-1, -1), 10)]))
    return t


def build(path, story, footer_left):
    """Write the PDF with "footer_left · Página n de N" on every page."""

    class NumberedCanvas(pdfcanvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._pages = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for state in self._pages:
                self.__dict__.update(state)
                self.setFont('Sans', 7.5)
                self.setFillColor(MUTED)
                self.drawString(18 * mm, 10 * mm, footer_left)
                self.drawRightString(A4[0] - 18 * mm, 10 * mm, f'Página {self._pageNumber} de {total}')
                self.setStrokeColor(LINE)
                self.line(18 * mm, 13.5 * mm, A4[0] - 18 * mm, 13.5 * mm)
                super().showPage()
            super().save()

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=19 * mm, title=footer_left, author='SIGTAP Explorador')
    doc.build(story, canvasmaker=NumberedCanvas)


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def load_procs(data_dir):
    procs = {}
    for path in sorted(Path(data_dir).glob('group-[0-9][0-9].json')):
        procs.update(load_json(path))
    return procs
