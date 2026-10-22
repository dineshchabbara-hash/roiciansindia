"""Original technical illustrations for the ROICIANS TECH website prototype.
All artwork is generated here from basic shapes (no third-party images).
Style: light product-UI panels, brand blues, small teal/amber/coral accents,
soft shadows, no glow, no heavy gradients, no robots."""
import math, random, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

NAVY = "#14263F"; LOGO = "#2E496C"; COBALT = "#2347D0"; COB2 = "#4F6EE0"; COB3 = "#A9BBF5"; COB4 = "#D9E3FF"
SKY = "#F1F6FF"; SKY2 = "#E4EDFF"; WHITE = "#FFFFFF"; LINE = "#DCE5F4"; GREY = "#C9D4E6"; GREY2 = "#E9EFF8"
TEAL = "#159A8C"; TEAL2 = "#BFE8E2"; AMBER = "#E3A033"; AMBER2 = "#FBE6C2"; CORAL = "#E0654F"; CORAL2 = "#F9D6CF"
FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'Geist Mono', ui-monospace, Menlo, Consolas, monospace"


def doc(w, h, body, bg=SKY, title=""):
    defs = f'''<defs>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#14263F" flood-opacity="0.10"/></filter>
  <filter id="sh2" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#14263F" flood-opacity="0.10"/></filter>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#C9D7F2"/></pattern>
</defs>'''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{defs}<rect width="{w}" height="{h}" fill="{bg}"/>'
            f'<rect width="{w}" height="{h}" fill="url(#dots)" opacity="0.55"/>{body}</svg>')


def blob(cx, cy, r, fill=SKY2, op=1):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" opacity="{op}"/>'


def window(x, y, w, h, title="", body="", shadow="sh", chrome=True, fill=WHITE, r=16):
    s = f'<g filter="url(#{shadow})"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"/></g>'
    s += f'<rect x="{x+0.5}" y="{y+0.5}" width="{w-1}" height="{h-1}" rx="{r}" fill="none" stroke="{LINE}"/>'
    if chrome:
        s += f'<path d="M{x} {y+44} H{x+w}" stroke="{LINE}"/>'
        for i, c in enumerate(["#F0A69A", "#F3CF7A", "#9AD6B9"]):
            s += f'<circle cx="{x+22+i*16}" cy="{y+22}" r="5" fill="{c}"/>'
        if title:
            s += f'<text x="{x+80}" y="{y+27}" font-family="{MONO}" font-size="13" fill="#6B7C98">{title}</text>'
    return s + body


def bar(x, y, w, h=10, fill=GREY2, r=5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"/>'


def text(x, y, t, size=14, fill=NAVY, weight=600, font=FONT, anchor="start"):
    return f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{t}</text>'


def pill(x, y, w, h, fill, label="", tc=WHITE, size=12):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{fill}"/>'
    if label:
        s += text(x + w/2, y + h/2 + size*0.36, label, size, tc, 600, FONT, "middle")
    return s


def check(cx, cy, r=11, fill=TEAL):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'
            f'<path d="M{cx-r*0.45} {cy} l{r*0.32} {r*0.32} l{r*0.6} {-r*0.62}" fill="none" stroke="#fff" stroke-width="{r*0.26}" stroke-linecap="round" stroke-linejoin="round"/>')


def cross(cx, cy, r=11, fill=CORAL):
    d = r*0.38
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'
            f'<path d="M{cx-d} {cy-d} L{cx+d} {cy+d} M{cx+d} {cy-d} L{cx-d} {cy+d}" stroke="#fff" stroke-width="{r*0.26}" stroke-linecap="round"/>')


def bars_chart(x, y, w, h, vals, colors=None, gap=0.35, base=LINE):
    n = len(vals); bw = w / (n + (n-1)*gap); s = f'<path d="M{x} {y+h} H{x+w}" stroke="{base}" stroke-width="2"/>'
    for i, v in enumerate(vals):
        bh = h * v; bx = x + i*bw*(1+gap)
        c = colors[i % len(colors)] if colors else COBALT
        s += f'<rect x="{bx:.1f}" y="{y+h-bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="{min(6,bw/3):.1f}" fill="{c}"/>'
    return s


def line_chart(x, y, w, h, vals, stroke=COBALT, area=COB4, width=3.5, dots=True):
    n = len(vals); pts = [(x + w*i/(n-1), y + h*(1-v)) for i, v in enumerate(vals)]
    d = "M" + " L".join(f"{px:.1f} {py:.1f}" for px, py in pts)
    s = f'<path d="{d} L{x+w} {y+h} L{x} {y+h} Z" fill="{area}" opacity="0.7"/>' if area else ""
    s += f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/>'
    if dots:
        px, py = pts[-1]; s += f'<circle cx="{px:.1f}" cy="{py:.1f}" r="6" fill="{WHITE}" stroke="{stroke}" stroke-width="3"/>'
    return s


def donut(cx, cy, r, parts, width=16, track=GREY2):
    s = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{track}" stroke-width="{width}"/>'
    a0 = -math.pi/2
    for frac, col in parts:
        a1 = a0 + 2*math.pi*frac
        large = 1 if frac > 0.5 else 0
        x0, y0 = cx + r*math.cos(a0), cy + r*math.sin(a0); x1, y1 = cx + r*math.cos(a1), cy + r*math.sin(a1)
        s += f'<path d="M{x0:.1f} {y0:.1f} A{r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}" fill="none" stroke="{col}" stroke-width="{width}" stroke-linecap="round"/>'
        a0 = a1 + 0.08
    return s


def code_lines(x, y, rows, lh=24, scale=1.0):
    # rows: list of [(indent, width, color), ...]
    s = ""
    for i, row in enumerate(rows):
        cx = x
        for seg in row:
            ind, w, c = seg
            cx += ind
            s += bar(cx, y + i*lh, w*scale, 10, c)
            cx += w*scale + 8
    return s


def node(cx, cy, r=18, fill=WHITE, stroke=COBALT, sw=3, inner=None):
    s = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
    if inner:
        s += f'<circle cx="{cx}" cy="{cy}" r="{r*0.42}" fill="{inner}"/>'
    return s


def edge(x1, y1, x2, y2, c=COB3, w=2.5, dash=""):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{c}" stroke-width="{w}"{da} stroke-linecap="round"/>'


def curve(x1, y1, x2, y2, c=COB3, w=2.5, dash=""):
    mx = (x1 + x2)/2; da = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<path d="M{x1} {y1} C{mx} {y1} {mx} {y2} {x2} {y2}" fill="none" stroke="{c}" stroke-width="{w}"{da} stroke-linecap="round"/>'


def person_tile(x, y, w, h, tone=COB4, fig=COB3, label_w=60):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{tone}"/>'
    cx = x + w/2; head = min(w, h)*0.16
    s += f'<circle cx="{cx}" cy="{y+h*0.42}" r="{head}" fill="{fig}"/>'
    s += f'<path d="M{cx-head*2.1} {y+h*0.86} Q{cx} {y+h*0.52} {cx+head*2.1} {y+h*0.86} Z" fill="{fig}"/>'
    s += bar(x + 10, y + h - 20, label_w, 8, WHITE, 4)
    return s


def cylinder(cx, y, w, h, fill=COB4, stroke=COBALT):
    rx = w/2; ry = w*0.16
    return (f'<path d="M{cx-rx} {y} V{y+h} A{rx} {ry} 0 0 0 {cx+rx} {y+h} V{y}" fill="{fill}" stroke="{stroke}" stroke-width="3"/>'
            f'<ellipse cx="{cx}" cy="{y}" rx="{rx}" ry="{ry}" fill="{WHITE}" stroke="{stroke}" stroke-width="3"/>'
            f'<path d="M{cx-rx} {y+h*0.45} A{rx} {ry} 0 0 0 {cx+rx} {y+h*0.45}" fill="none" stroke="{stroke}" stroke-width="2.5" opacity="0.7"/>')


def shield(cx, cy, s=1.0, fill=COBALT):
    w = 120*s; h = 140*s
    d = (f"M{cx} {cy-h/2} L{cx+w/2} {cy-h/2+h*0.18} V{cy+h*0.02} "
         f"C{cx+w/2} {cy+h*0.30} {cx+w*0.22} {cy+h*0.45} {cx} {cy+h/2} "
         f"C{cx-w*0.22} {cy+h*0.45} {cx-w/2} {cy+h*0.30} {cx-w/2} {cy+h*0.02} V{cy-h/2+h*0.18} Z")
    lock = (f'<rect x="{cx-22*s}" y="{cy-2*s}" width="{44*s}" height="{36*s}" rx="{6*s}" fill="{WHITE}"/>'
            f'<path d="M{cx-13*s} {cy-2*s} V{cy-14*s} A{13*s} {13*s} 0 0 1 {cx+13*s} {cy-14*s} V{cy-2*s}" fill="none" stroke="{WHITE}" stroke-width="{6*s}"/>'
            f'<circle cx="{cx}" cy="{cy+14*s}" r="{5*s}" fill="{fill}"/>')
    return f'<g filter="url(#sh2)"><path d="{d}" fill="{fill}"/></g>' + lock


def cloud(cx, cy, s=1.0, fill=WHITE, stroke=COBALT):
    d = (f"M{cx-110*s} {cy+40*s} H{cx+105*s} A{48*s} {48*s} 0 0 0 {cx+92*s} {cy-52*s} "
         f"A{70*s} {70*s} 0 0 0 {cx-40*s} {cy-62*s} A{52*s} {52*s} 0 0 0 {cx-112*s} {cy-6*s} A{44*s} {44*s} 0 0 0 {cx-110*s} {cy+40*s} Z")
    return f'<g filter="url(#sh2)"><path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="3.5" stroke-linejoin="round"/></g>'


def gear(cx, cy, r, fill=COB3, teeth=8):
    pts = []
    for i in range(teeth*2):
        a = math.pi*i/teeth; rr = r if i % 2 == 0 else r*0.78
        for da in (-0.18, 0.18):
            pts.append((cx + rr*math.cos(a+da), cy + rr*math.sin(a+da)))
    d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"
    return f'<path d="{d}" fill="{fill}"/><circle cx="{cx}" cy="{cy}" r="{r*0.36}" fill="{WHITE}"/>'


def save(name, svg):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(svg)


R = random.Random(22)

# ---------------------------------------------------------------- program images (960x600)
W, H = 960, 600

# 1 Testing & QA
b = blob(820, 120, 210) + blob(120, 560, 170, COB4, 0.6)
rows = ""
items = [("Checkout flow", True), ("Login and session", True), ("Search filters", True), ("Payment retry", False), ("Profile update", True)]
for i, (lbl, ok) in enumerate(items):
    yy = 150 + i*56
    rows += (check(132, yy, 12) if ok else cross(132, yy, 12)) + bar(160, yy-6, 190 - (i % 3)*30, 12, GREY) + pill(470, yy-12, 64, 24, TEAL2 if ok else CORAL2, "PASS" if ok else "FAIL", TEAL if ok else CORAL, 11)
b += window(90, 70, 480, 420, "test-suite / regression", rows + bar(120, 440, 420, 10, GREY2) + bar(120, 440, 340, 10, TEAL))
b += window(610, 120, 270, 250, "coverage", donut(745, 260, 70, [(0.62, COBALT), (0.2, TEAL)], 20), chrome=True)
b += f'<g filter="url(#sh2)"><circle cx="760" cy="470" r="58" fill="{WHITE}"/></g><circle cx="760" cy="470" r="58" fill="none" stroke="{LINE}"/>'
b += f'<circle cx="752" cy="462" r="26" fill="none" stroke="{COBALT}" stroke-width="7"/><path d="M771 481 L792 502" stroke="{COBALT}" stroke-width="9" stroke-linecap="round"/>'
b += f'<ellipse cx="752" cy="462" rx="9" ry="12" fill="{CORAL}"/><path d="M738 452 l7 5 M766 452 l-7 5 M737 466 h8 M767 466 h-8" stroke="{CORAL}" stroke-width="3" stroke-linecap="round"/>'
save("program-testing.svg", doc(W, H, b, title="Illustration: automated test results, coverage and bug inspection"))

# 2 Data Analytics with AI
b = blob(160, 110, 200) + blob(860, 540, 190, COB4, 0.7)
kp = ""
for i, c in enumerate([COBALT, TEAL, AMBER]):
    kx = 120 + i*150
    kp += f'<rect x="{kx}" y="140" width="130" height="72" rx="12" fill="{SKY}"/>' + bar(kx+16, 158, 60, 8, GREY) + bar(kx+16, 180, 80, 14, c, 6)
b += window(90, 70, 520, 460, "sales-insights.dashboard", kp + line_chart(120, 250, 460, 150, [0.25, 0.32, 0.3, 0.45, 0.42, 0.58, 0.55, 0.7, 0.66, 0.82]) + bars_chart(120, 420, 460, 80, [0.4, 0.7, 0.5, 0.85, 0.6, 0.9, 0.45, 0.75], [COB3, COBALT]))
b += window(640, 110, 250, 230, "segments", donut(765, 240, 62, [(0.45, COBALT), (0.3, TEAL), (0.17, AMBER)], 22))
b += window(640, 370, 250, 170, "ask the data", bar(664, 432, 190, 12, GREY2) + bar(664, 456, 150, 12, GREY2) + pill(664, 488, 120, 28, COBALT, "Insight", WHITE, 12))
save("program-data-analytics.svg", doc(W, H, b, title="Illustration: analytics dashboard with charts and segments"))

# 3 Cybersecurity & SOC
b = blob(480, 300, 250, SKY2) + blob(880, 80, 140, COB4, 0.7)
nodes = [(170, 160), (130, 330), (230, 470), (360, 120), (330, 520)]
for (x1, y1) in nodes:
    b += edge(x1, y1, 480, 300, COB3, 2.5, "6 7")
for i, (x1, y1) in enumerate(nodes):
    b += node(x1, y1, 22, WHITE, CORAL if i == 2 else COBALT, 3, CORAL2 if i == 2 else COB4)
b += f'<circle cx="480" cy="300" r="130" fill="none" stroke="{COB3}" stroke-width="2" stroke-dasharray="2 10"/>'
b += shield(480, 300, 1.25)
feed = ""
sev = [(CORAL, CORAL2), (AMBER, AMBER2), (TEAL, TEAL2), (AMBER, AMBER2), (TEAL, TEAL2)]
for i, (c, c2) in enumerate(sev):
    yy = 140 + i*58
    feed += f'<rect x="676" y="{yy-18}" width="200" height="44" rx="10" fill="{SKY}"/>' + f'<rect x="676" y="{yy-18}" width="6" height="44" rx="3" fill="{c}"/>' + bar(694, yy-6, 110 - (i % 2)*30, 9, GREY) + bar(694, yy+10, 70, 7, GREY2) + pill(824, yy-8, 40, 18, c2)
b += window(650, 60, 250, 380, "alerts / triage", feed)
save("program-cybersecurity.svg", doc(W, H, b, title="Illustration: security shield, monitored network and alert triage"))

# 4 Cloud & DevOps
b = blob(300, 140, 220) + blob(820, 520, 180, COB4, 0.7)
b += cloud(320, 220, 1.35)
for i, c in enumerate([COBALT, TEAL, COB2, AMBER]):
    bx = 222 + i*52
    b += f'<rect x="{bx}" y="200" width="40" height="40" rx="8" fill="{c}"/><path d="M{bx+8} 214 h24 M{bx+8} 226 h16" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.85"/>'
stages = [("build", COBALT), ("test", TEAL), ("release", COB2), ("deploy", AMBER)]
pl = ""
for i, (lbl, c) in enumerate(stages):
    sx = 120 + i*178
    pl += f'<rect x="{sx}" y="430" width="150" height="64" rx="14" fill="{WHITE}" stroke="{LINE}"/>' + f'<circle cx="{sx+30}" cy="462" r="13" fill="{c}"/>' + text(sx+54, 468, lbl, 17, NAVY, 600, MONO)
    if i < 3:
        pl += f'<path d="M{sx+154} 462 h20" stroke="{COB3}" stroke-width="3"/><path d="M{sx+168} 455 l8 7 l-8 7" fill="none" stroke="{COB3}" stroke-width="3"/>'
b += f'<g filter="url(#sh)"><rect x="100" y="400" width="760" height="124" rx="20" fill="{SKY}"/></g>' + pl
inf = (f'<path d="M690 210 C690 160 760 160 790 210 C820 260 890 260 890 210 C890 160 820 160 790 210 C760 260 690 260 690 210 Z" fill="none" stroke="{COBALT}" stroke-width="12" stroke-linecap="round"/>')
b += f'<g filter="url(#sh2)"><rect x="650" y="120" width="280" height="180" rx="18" fill="{WHITE}"/></g>' + inf
save("program-cloud-devops.svg", doc(W, H, b, title="Illustration: cloud workloads and a CI/CD delivery pipeline"))

# 5 Applied AI & ML
b = blob(220, 480, 200) + blob(800, 120, 200, COB4, 0.7)
pts = ""
for i in range(46):
    x = R.uniform(120, 560); y = R.uniform(130, 470)
    above = y < 470 - (x-120)*0.55 - 40*math.sin((x-120)/60)
    pts += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="7" fill="{COBALT if above else TEAL}" opacity="0.9"/>'
bd = "M" + " L".join(f"{x} {470 - (x-120)*0.55 - 40*math.sin((x-120)/60) + 0:.0f}" for x in range(110, 571, 20))
b += window(90, 70, 500, 440, "classifier / decision boundary", f'<path d="{bd}" fill="none" stroke="{NAVY}" stroke-width="3.5" stroke-dasharray="10 8"/>' + pts)
layers = [3, 5, 5, 2]; lx0 = 660; pos = []
for li, n in enumerate(layers):
    col = []
    for j in range(n):
        col.append((lx0 + li*72, 300 - (n-1)*34 + j*68))
    pos.append(col)
nn = ""
for li in range(len(pos)-1):
    for (x1, y1) in pos[li]:
        for (x2, y2) in pos[li+1]:
            nn += edge(x1, y1, x2, y2, COB3, 1.4)
for li, col in enumerate(pos):
    for (x, y) in col:
        nn += node(x, y, 14, WHITE, COBALT if li not in (3,) else TEAL, 3, COB4 if li not in (3,) else TEAL2)
b += f'<g filter="url(#sh)"><rect x="625" y="110" width="290" height="380" rx="18" fill="{WHITE}"/></g>' + nn
save("program-applied-ml.svg", doc(W, H, b, title="Illustration: classifier decision boundary and a neural network"))

# 6 Generative AI & LLMOps
b = blob(820, 140, 210) + blob(140, 520, 170, COB4, 0.7)
chat = (f'<rect x="120" y="120" width="300" height="70" rx="16" fill="{SKY}"/>' + bar(140, 140, 220, 10, GREY) + bar(140, 160, 160, 10, GREY) +
        f'<rect x="230" y="210" width="320" height="110" rx="16" fill="{COBALT}"/>' + bar(252, 232, 270, 10, COB3) + bar(252, 252, 240, 10, COB3) + bar(252, 272, 200, 10, COB3) + bar(252, 292, 120, 10, COB3) +
        f'<rect x="120" y="340" width="260" height="60" rx="16" fill="{SKY}"/>' + bar(140, 362, 200, 10, GREY) +
        f'<rect x="120" y="430" width="430" height="48" rx="24" fill="{WHITE}" stroke="{LINE}"/>' + bar(144, 449, 220, 10, GREY2) + f'<circle cx="524" cy="454" r="16" fill="{COBALT}"/><path d="M517 454 h12 M524 447 l6 7 l-6 7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>')
b += window(90, 60, 490, 450, "assistant / chat", chat)
mon = line_chart(650, 170, 220, 90, [0.5, 0.42, 0.6, 0.48, 0.38, 0.44, 0.3, 0.35], TEAL, TEAL2, 3) + text(650, 300, "latency", 13, "#6B7C98", 500, MONO)
toks = "".join(f'<rect x="{650 + i*28}" y="330" width="22" height="22" rx="5" fill="{[COB4, COB3, COBALT][i % 3]}"/>' for i in range(8))
b += window(620, 90, 280, 300, "llmops / monitor", mon + toks + text(650, 380, "tokens", 13, "#6B7C98", 500, MONO))
b += window(620, 420, 280, 120, "", bar(644, 450, 150, 10, GREY) + bar(644, 472, 220, 10, GREY2) + bar(644, 494, 180, 10, GREY2) + pill(816, 444, 64, 22, AMBER2, "v3", AMBER, 11), chrome=False)
save("program-genai-llmops.svg", doc(W, H, b, title="Illustration: assistant chat window and model monitoring"))

# 7 Data Engineering & Cloud Platforms
b = blob(480, 120, 230) + blob(150, 520, 160, COB4, 0.7)
b += cylinder(150, 170, 100, 90) + cylinder(150, 330, 100, 90, TEAL2, TEAL)
b += f'<g filter="url(#sh2)"><rect x="95" y="460" width="110" height="80" rx="10" fill="{WHITE}" stroke="{LINE}"/></g>' + bar(112, 482, 76, 8, GREY) + bar(112, 500, 60, 8, GREY2) + bar(112, 518, 70, 8, GREY2)
for yy in (215, 375, 500):
    b += curve(210, yy, 380, 330, COB3, 3, "8 8")
pipe = f'<rect x="390" y="270" width="220" height="120" rx="18" fill="{COBALT}"/>'
pipe += gear(445, 330, 30, COB3) + gear(515, 315, 20, WHITE) + gear(560, 350, 16, COB3)
b += f'<g filter="url(#sh)">{pipe}</g>'
b += curve(612, 330, 720, 250, COB3, 3, "8 8") + curve(612, 330, 720, 440, COB3, 3, "8 8")
b += cylinder(790, 180, 150, 120, COB4, COBALT)
b += window(700, 400, 200, 140, "", bars_chart(724, 424, 150, 90, [0.5, 0.8, 0.6, 0.95, 0.7], [COB3, COBALT]), chrome=False)
save("program-data-engineering.svg", doc(W, H, b, title="Illustration: data sources flowing through a pipeline into a warehouse"))

# 8 API Integration & Automation
b = blob(160, 140, 190) + blob(820, 500, 200, COB4, 0.7)
eps = [("GET", "/orders", TEAL), ("POST", "/invoices", COBALT), ("PUT", "/customers", AMBER)]
for i, (m, p, c) in enumerate(eps):
    yy = 110 + i*150
    b += window(80, yy, 300, 110, "", pill(104, yy+22, 64, 26, c, m, WHITE, 12) + text(182, yy+41, p, 18, NAVY, 600, MONO) + bar(104, yy+70, 230, 9, GREY2) + bar(104, yy+86, 170, 9, GREY2), chrome=False)
    b += curve(382, yy+55, 520, 300, COB3, 3)
hub = f'<circle cx="560" cy="300" r="62" fill="{COBALT}"/>' + f'<path d="M548 262 L528 306 H556 L540 340 L586 290 H558 L574 262 Z" fill="{WHITE}"/>'
b += f'<g filter="url(#sh)">{hub}</g>'
outs = [(800, 150), (840, 300), (800, 450)]
for (x, y) in outs:
    b += curve(622, 300, x-50, y, COB3, 3, "6 7")
    b += f'<g filter="url(#sh2)"><rect x="{x-48}" y="{y-40}" width="110" height="80" rx="16" fill="{WHITE}"/></g>'
b += gear(806, 150, 22, COB3) + text(828, 308, "{ }", 30, COBALT, 700, MONO, "middle") + check(806, 450, 18, TEAL)
save("program-api-automation.svg", doc(W, H, b, title="Illustration: API endpoints connected through an automation hub"))

# 9 Business Analysis with AI
b = blob(820, 110, 200) + blob(140, 530, 170, COB4, 0.7)
flow = ""
boxes = [(120, 150), (300, 150), (480, 120), (480, 220)]
flow += f'<rect x="120" y="150" width="130" height="60" rx="12" fill="{SKY}" stroke="{COB3}" stroke-width="2"/>' + bar(140, 176, 90, 10, GREY)
flow += f'<path d="M335 180 L385 150 L435 180 L385 210 Z" fill="{AMBER2}" stroke="{AMBER}" stroke-width="2.5"/>'
flow += f'<rect x="480" y="110" width="110" height="56" rx="12" fill="{COB4}" stroke="{COBALT}" stroke-width="2"/>' + bar(498, 134, 70, 10, COB3)
flow += f'<rect x="480" y="200" width="110" height="56" rx="12" fill="{TEAL2}" stroke="{TEAL}" stroke-width="2"/>' + bar(498, 224, 70, 10, "#8FD3C9")
flow += edge(252, 180, 330, 180, COB3, 3) + curve(437, 180, 476, 138, COB3, 3) + curve(437, 180, 476, 228, COB3, 3)
board = ""
for ci, c in enumerate([COB4, AMBER2, TEAL2]):
    cx = 120 + ci*160
    board += bar(cx, 300, 100, 10, GREY)
    for r in range(2 + (ci == 0)):
        board += f'<rect x="{cx}" y="{324 + r*58}" width="140" height="48" rx="10" fill="{c}"/>' + bar(cx+12, 342 + r*58, 90 - r*12, 9, WHITE)
b += window(90, 60, 540, 470, "process / backlog", flow + board)
doc_ = "".join(check(696, 160 + i*44, 10, TEAL if i < 3 else GREY) + bar(716, 154 + i*44, 140 - (i % 2)*30, 11, GREY) for i in range(5))
b += window(660, 90, 240, 280, "requirements", doc_)
b += window(660, 400, 240, 140, "", bars_chart(684, 420, 190, 96, [0.4, 0.6, 0.55, 0.85], [COB3, COB3, COB3, COBALT]), chrome=False)
save("program-business-analysis.svg", doc(W, H, b, title="Illustration: process map, backlog board and requirements checklist"))

# 10 GenAI & AI Agents for Business Professionals
b = blob(480, 300, 240) + blob(860, 90, 140, COB4, 0.7)
center = (480, 300)
apps = [(200, 140, "mail"), (200, 460, "cal"), (760, 140, "doc"), (760, 460, "sheet"), (480, 90, "chat")]
for (x, y, k) in apps:
    b += curve(center[0], center[1], x, y, COB3, 3, "6 7") if k != "chat" else edge(480, 300, 480, 130, COB3, 3, "6 7")
b += f'<g filter="url(#sh)"><circle cx="480" cy="300" r="78" fill="{WHITE}"/></g><circle cx="480" cy="300" r="78" fill="none" stroke="{LINE}"/>'
b += f'<circle cx="480" cy="300" r="54" fill="{COBALT}"/>'
for k in range(6):
    a = k*math.pi/3
    b += f'<circle cx="{480+28*math.cos(a):.1f}" cy="{300+28*math.sin(a):.1f}" r="7" fill="{WHITE}"/>'
b += f'<circle cx="480" cy="300" r="9" fill="{COB3}"/>'
def appcard(x, y, kind):
    s = f'<g filter="url(#sh2)"><rect x="{x-62}" y="{y-46}" width="124" height="92" rx="18" fill="{WHITE}"/></g>'
    if kind == "mail":
        s += f'<rect x="{x-30}" y="{y-20}" width="60" height="42" rx="6" fill="{COB4}" stroke="{COBALT}" stroke-width="3"/><path d="M{x-30} {y-18} L{x} {y+4} L{x+30} {y-18}" fill="none" stroke="{COBALT}" stroke-width="3"/>'
    elif kind == "cal":
        s += f'<rect x="{x-30}" y="{y-24}" width="60" height="50" rx="7" fill="{WHITE}" stroke="{TEAL}" stroke-width="3"/><rect x="{x-30}" y="{y-24}" width="60" height="14" rx="5" fill="{TEAL}"/>'
        s += "".join(f'<rect x="{x-22+ (i%3)*16}" y="{y-2 + (i//3)*12}" width="10" height="8" rx="2" fill="{TEAL2}"/>' for i in range(6))
    elif kind == "doc":
        s += f'<rect x="{x-24}" y="{y-30}" width="48" height="60" rx="6" fill="{WHITE}" stroke="{COBALT}" stroke-width="3"/>' + "".join(bar(x-14, y-16 + i*12, 28 - (i == 3)*10, 5, COB3, 2) for i in range(4))
    elif kind == "sheet":
        s += f'<rect x="{x-30}" y="{y-26}" width="60" height="52" rx="6" fill="{WHITE}" stroke="{AMBER}" stroke-width="3"/>' + "".join(f'<path d="M{x-30} {y-26 + i*13} H{x+30}" stroke="{AMBER2}" stroke-width="2"/>' for i in range(1, 4)) + f'<path d="M{x-6} {y-26} V{y+26}" stroke="{AMBER2}" stroke-width="2"/>'
    else:
        s += f'<rect x="{x-32}" y="{y-22}" width="64" height="40" rx="12" fill="{COB4}"/><path d="M{x-16} {y+18} l-8 12 l20 -12" fill="{COB4}"/>' + bar(x-20, y-8, 40, 6, COB3, 3) + bar(x-20, y+3, 28, 6, COB3, 3)
    return s
for (x, y, k) in apps:
    b += appcard(x, y, k)
b += pill(380, 410, 200, 34, WHITE, "", NAVY) + f'<rect x="380" y="410" width="200" height="34" rx="17" fill="none" stroke="{LINE}"/>' + check(402, 427, 10, TEAL) + bar(420, 422, 140, 10, GREY)
save("program-genai-agents.svg", doc(W, H, b, title="Illustration: an AI assistant coordinating everyday business tools"))

# ---------------------------------------------------------------- hero images (1200x900)
HW, HH = 1200, 900

# Hero 1: technology career training (learner workspace)
b = blob(980, 160, 300) + blob(160, 780, 260, COB4, 0.7)
code = code_lines(150, 210, [
    [(0, 70, COBALT), (0, 120, GREY)], [(28, 90, TEAL), (0, 160, GREY)], [(28, 60, COB3), (0, 90, AMBER), (0, 70, GREY)],
    [(56, 140, GREY)], [(56, 80, COBALT), (0, 110, GREY)], [(28, 40, COB3)], [(0, 40, COB3)], [], [(0, 90, COBALT), (0, 140, GREY)],
    [(28, 120, TEAL), (0, 80, GREY)], [(28, 170, GREY)], [(0, 40, COB3)]], 30, 1.25)
gut = "".join(bar(112, 210 + i*30, 18, 10, GREY2) for i in range(12))
b += window(90, 120, 640, 520, "project / app.py", gut + code)
term = (text(800, 600, "$ run tests", 17, "#B9C6E6", 500, MONO) + check(812, 640, 11, TEAL) + bar(834, 634, 150, 10, "#3B5578") +
        check(812, 676, 11, TEAL) + bar(834, 670, 120, 10, "#3B5578") + check(812, 712, 11, TEAL) + bar(834, 706, 170, 10, "#3B5578"))
b += window(770, 540, 340, 230, "terminal", term, fill=NAVY)
b += f'<rect x="770.5" y="540.5" width="339" height="229" rx="16" fill="none" stroke="{NAVY}"/>'
# progress / learning path card
path = ""
for i in range(5):
    cy = 230 + i*58; done = i < 3
    path += (check(820, cy, 13, TEAL) if done else f'<circle cx="820" cy="{cy}" r="13" fill="{WHITE}" stroke="{COB3 if i==4 else COBALT}" stroke-width="3"/>')
    path += bar(846, cy-6, 170 - (i % 2)*40, 12, GREY if done else (COB4 if i == 3 else GREY2))
    if i < 4: path += edge(820, cy+14, 820, cy+44, TEAL if i < 2 else COB3, 3)
b += window(780, 130, 320, 380, "learning path", path + bar(806, 468, 270, 10, GREY2) + bar(806, 468, 170, 10, COBALT))
b += f'<g filter="url(#sh2)"><rect x="160" y="690" width="420" height="110" rx="18" fill="{WHITE}"/></g>' + f'<rect x="184" y="714" width="62" height="62" rx="14" fill="{COB4}"/>' + gear(215, 745, 20, COBALT) + bar(266, 722, 200, 12, GREY) + bar(266, 746, 270, 10, GREY2) + bar(266, 766, 160, 10, GREY2)
save("hero-career.svg", doc(HW, HH, b, title="Illustration: a learner's code editor, test run and learning path"))

# Hero 2: corporate AI and technology upskilling (team session)
b = blob(220, 160, 280) + blob(1020, 760, 260, COB4, 0.7)
tiles = ""
tones = [(COB4, COB3), (TEAL2, "#8FD3C9"), (AMBER2, "#F2C47E"), (COB4, COB3), (SKY2, "#B7C7EE"), (TEAL2, "#8FD3C9")]
for i, (t, f) in enumerate(tones):
    tx = 120 + (i % 3)*176; ty = 560 + (i // 3)*130
    tiles += person_tile(tx, ty, 160, 116, t, f, 50 + (i % 3)*14)
# shared screen with roadmap
road = ""
cols = [COBALT, TEAL, AMBER, COB2]
for i in range(4):
    rx = 150 + i*130
    road += f'<rect x="{rx}" y="190" width="112" height="44" rx="10" fill="{[COB4, TEAL2, AMBER2, COB4][i]}"/>' + bar(rx+12, 207, 70, 10, cols[i])
    if i < 3: road += f'<path d="M{rx+114} 212 h12" stroke="{COB3}" stroke-width="3"/>'
road += line_chart(150, 280, 500, 150, [0.2, 0.28, 0.33, 0.42, 0.5, 0.56, 0.66, 0.74], COBALT, COB4, 4)
b += window(90, 100, 600, 420, "team workshop / shared screen", road) + tiles
side = ""
for i in range(4):
    yy = 210 + i*70
    side += f'<circle cx="790" cy="{yy}" r="20" fill="{[COB4, TEAL2, AMBER2, SKY2][i]}"/>' + bar(822, yy-14, 170 - (i % 2)*50, 11, GREY) + bar(822, yy+6, 120, 9, GREY2)
b += window(740, 120, 360, 340, "cohort plan", side)
b += window(740, 500, 360, 290, "skills map", bars_chart(780, 560, 280, 170, [0.45, 0.7, 0.55, 0.85, 0.62], [COB3, COBALT, TEAL, COBALT, COB3]))
save("hero-corporate.svg", doc(HW, HH, b, title="Illustration: a team training session with a shared roadmap, cohort plan and skills map"))

# Hero 3: advanced AI and professional learning (model + agent pipeline)
b = blob(600, 450, 360, SKY2) + blob(1080, 120, 200, COB4, 0.7)
# prompt card
b += window(80, 140, 300, 230, "prompt", bar(104, 210, 230, 11, GREY) + bar(104, 234, 200, 11, GREY) + bar(104, 258, 240, 11, GREY) + bar(104, 282, 140, 11, GREY) + pill(104, 316, 110, 30, COB4, "context", COBALT, 12))
# vector store
b += cylinder(230, 560, 150, 130, COB4, COBALT)
b += text(230, 760, "knowledge", 18, LOGO, 600, MONO, "middle")
# model graph
layers = [4, 6, 6, 3]; pos = []
for li, n in enumerate(layers):
    pos.append([(500 + li*95, 450 - (n-1)*42 + j*84) for j in range(n)])
g = ""
for li in range(len(pos)-1):
    for (x1, y1) in pos[li]:
        for (x2, y2) in pos[li+1]:
            g += edge(x1, y1, x2, y2, COB3, 1.3)
for li, col in enumerate(pos):
    for (x, y) in col:
        g += node(x, y, 16, WHITE, COBALT, 3, COB4)
b += f'<g filter="url(#sh)"><rect x="450" y="170" width="390" height="560" rx="24" fill="{WHITE}"/></g>' + g
b += curve(382, 255, 470, 330, COB3, 3, "7 8") + curve(306, 600, 470, 560, COB3, 3, "7 8")
# evaluation card with gauge
gauge = (f'<path d="M930 420 A110 110 0 0 1 1150 420" fill="none" stroke="{GREY2}" stroke-width="20" stroke-linecap="round"/>'
         f'<path d="M930 420 A110 110 0 0 1 1110 342" fill="none" stroke="{TEAL}" stroke-width="20" stroke-linecap="round"/>'
         f'<path d="M1040 420 L1092 360" stroke="{NAVY}" stroke-width="6" stroke-linecap="round"/><circle cx="1040" cy="420" r="10" fill="{NAVY}"/>')
b += window(890, 230, 290, 260, "evaluation", gauge + bar(930, 450, 200, 10, GREY2))
agent = ""
for i, c in enumerate([COBALT, TEAL, AMBER]):
    yy = 600 + i*62
    agent += f'<rect x="914" y="{yy-22}" width="240" height="46" rx="12" fill="{SKY}"/><circle cx="938" cy="{yy+1}" r="11" fill="{c}"/>' + bar(960, yy-5, 150 - i*20, 11, GREY)
b += window(890, 530, 290, 260, "agent steps", agent)
b += curve(840, 450, 890, 360, COB3, 3, "7 8") + curve(840, 450, 890, 660, COB3, 3, "7 8")
save("hero-ai.svg", doc(HW, HH, b, title="Illustration: an AI pipeline from prompt and knowledge store to model, evaluation and agent steps"))

# ---------------------------------------------------------------- corporate section image (1200x900)
b = blob(980, 200, 280) + blob(180, 760, 240, COB4, 0.7)
# presentation screen with facilitator silhouette
screen = (bar(170, 190, 260, 18, NAVY, 6) + bar(170, 230, 380, 11, GREY) + bar(170, 254, 330, 11, GREY) +
          bars_chart(170, 300, 380, 170, [0.35, 0.5, 0.62, 0.8, 0.9], [COB3, COB3, COBALT, COBALT, TEAL]) +
          f'<rect x="600" y="190" width="190" height="280" rx="14" fill="{SKY}"/>' + "".join(check(630, 230 + i*52, 11, TEAL) + bar(652, 224 + i*52, 110 - (i % 2)*30, 11, GREY) for i in range(4)))
b += window(120, 110, 720, 430, "upskilling programme / session 1", screen)
# participants table row
for i in range(5):
    tx = 140 + i*196
    b += person_tile(tx, 640, 176, 150, [COB4, TEAL2, AMBER2, SKY2, COB4][i], [COB3, "#8FD3C9", "#F2C47E", "#B7C7EE", COB3][i], 60 + (i % 3)*12)
# sticky notes board
notes = ""
for i in range(6):
    nx = 1000 + (i % 2)*82 - 40; ny = 150 + (i // 2)*96
    notes += f'<rect x="{nx}" y="{ny}" width="72" height="72" rx="8" fill="{[AMBER2, TEAL2, COB4][i % 3]}"/>' + bar(nx+10, ny+16, 50, 7, WHITE) + bar(nx+10, ny+30, 38, 7, WHITE)
b += f'<g filter="url(#sh)"><rect x="940" y="110" width="200" height="330" rx="18" fill="{WHITE}"/></g>' + notes
save("corporate-session.svg", doc(HW, HH, b, title="Illustration: a team upskilling session with presentation, facilitator, participants and planning board"))

# ---------------------------------------------------------------- institutions image (960x600)
b = blob(160, 120, 190) + blob(840, 520, 200, COB4, 0.7)
camp = f'<path d="M180 260 L480 140 L780 260 Z" fill="{COB4}" stroke="{COBALT}" stroke-width="4" stroke-linejoin="round"/>'
for i in range(6):
    camp += f'<rect x="{220 + i*92}" y="280" width="40" height="170" rx="8" fill="{WHITE}" stroke="{COB3}" stroke-width="3"/>'
camp += f'<rect x="170" y="450" width="620" height="34" rx="10" fill="{COBALT}"/><rect x="200" y="260" width="560" height="20" rx="6" fill="{COB3}"/>'
b += f'<g filter="url(#sh)"><rect x="120" y="100" width="720" height="420" rx="24" fill="{WHITE}"/></g>' + camp
b += f'<g filter="url(#sh2)"><rect x="700" y="80" width="190" height="120" rx="18" fill="{WHITE}"/></g>' + bars_chart(726, 100, 140, 76, [0.4, 0.65, 0.8, 0.95], [COB3, COB3, COBALT, TEAL])
save("institutions.svg", doc(W, H, b, title="Illustration: a campus building with a learning progress chart"))
print("ok", sorted(os.listdir(OUT)))
