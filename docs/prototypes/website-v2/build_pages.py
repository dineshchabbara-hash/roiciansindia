"""Builds programs.html, logo-options.html and notes.html for the ROICIANS TECH
website prototype v2, reusing the header and footer from index.html so that
navigation is identical on every page. Run from this folder: python3 build_pages.py"""
import re, hashlib, html

idx = open("index.html", encoding="utf-8").read()
start = idx.index('<div class="proto-bar"'); end = idx.index("</header>") + len("</header>")
header = idx[start:end]
fstart = idx.index('<footer class="site-footer">'); fend = idx.index("</footer>") + len("</footer>")
footer = idx[fstart:fend]


def relink(block):
    # In-page anchors of the homepage become links back to it.
    return re.sub(r'href="#(upcoming|corporate|institutions|enquire)"', r'href="index.html#\1"', block)


def page(title, body, current=None, desc=""):
    h = relink(header)
    if current:
        h = h.replace(f'<a href="{current}">', f'<a href="{current}" aria-current="page">', 1)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="{html.escape(desc)}">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600;700&family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="styles.css">
</head>
<body>
{h}
<main>
{body}
</main>
{relink(footer)}
<script src="site.js"></script>
</body>
</html>
'''


ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10 M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
PROTO_DETAIL = "Program detail pages are built in Phase 22E. In this prototype the link goes nowhere."

# Approved Program names and groups (design section 6.1). Descriptions are sample copy.
career = [
    ("AI-Powered Software Testing &amp; QA", "program-testing.svg", "Automate testing and build quality into modern software delivery.", "automated test results and coverage"),
    ("Data Analytics with AI", "program-data-analytics.svg", "Turn data into clear answers with analysis, visualisation and AI-assisted tools.", "an analytics dashboard"),
    ("Cybersecurity &amp; SOC Analyst", "program-cybersecurity.svg", "Monitor, detect and respond to threats in a security operations role.", "a security shield and alert triage"),
    ("Cloud &amp; DevOps Engineering", "program-cloud-devops.svg", "Build, ship and run applications on cloud platforms with modern delivery pipelines.", "cloud workloads and a delivery pipeline"),
    ("Applied AI &amp; Machine Learning", "program-applied-ml.svg", "Train, evaluate and deploy machine learning models for real problems.", "a classifier and a neural network"),
    ("Generative AI &amp; LLMOps Engineering", "program-genai-llmops.svg", "Build, deploy and operate applications on large language models.", "an assistant chat and model monitoring"),
]
specialist = [
    ("Data Engineering &amp; Cloud Platforms", "program-data-engineering.svg", "Design reliable data pipelines and platforms in the cloud.", "data flowing through a pipeline into a warehouse"),
    ("API Integration &amp; Automation", "program-api-automation.svg", "Connect systems through APIs and automate everyday workflows.", "API endpoints connected through an automation hub"),
    ("Business Analysis with AI", "program-business-analysis.svg", "Map processes, write clear requirements and use AI to work faster.", "a process map and requirements checklist"),
    ("Generative AI &amp; AI Agents for Business Professionals", "program-genai-agents.svg", "Use generative AI and AI agents in everyday business work, without coding.", "an AI assistant coordinating business tools"),
]


def card(name, img, desc, alt):
    return f'''        <article class="pcard">
          <div class="media"><img src="assets/img/{img}" alt="Illustration of {alt}" width="960" height="600" loading="lazy"></div>
          <div class="body">
            <h3>{name}</h3>
            <p>{desc}</p>
            <a class="btn btn-primary btn-sm" href="#" data-proto="{PROTO_DETAIL}">Explore Program</a>
          </div>
        </article>'''


programs_body = f'''  <section class="page-intro" aria-labelledby="programs-title">
    <div class="wrap">
      <p class="crumbs"><a href="index.html">Home</a> / Programs</p>
      <h1 id="programs-title">Programs</h1>
      <p class="lede">Instructor-led technology programs for career starters, professionals and teams. Choose a group, or browse all ten.</p>
      <div class="filters" role="group" aria-label="Filter programs by group">
        <button class="filter" type="button" data-filter="all" aria-pressed="true">All programs <span class="n">10</span></button>
        <button class="filter" type="button" data-filter="career" aria-pressed="false">Career &amp; Technology <span class="n">6</span></button>
        <button class="filter" type="button" data-filter="specialist" aria-pressed="false">Specialist &amp; Professional <span class="n">4</span></button>
      </div>
      <p class="sr-only" id="filter-status" aria-live="polite"></p>
    </div>
  </section>

  <section class="section" aria-label="Program catalogue">
    <div class="wrap">
      <div class="group" id="career" data-group="career">
        <div class="group-head">
          <span class="eyebrow">Group 1</span>
          <h2>Career &amp; Technology Programs</h2>
          <p class="lede">Programs for building a career in software, data, cloud, security and AI.</p>
        </div>
        <div class="catalog">
{chr(10).join(card(*p) for p in career)}
        </div>
      </div>

      <div class="group" id="specialist" data-group="specialist">
        <div class="group-head">
          <span class="eyebrow">Group 2</span>
          <h2>Specialist &amp; Professional Programs</h2>
          <p class="lede">Focused programs for specialists and working professionals.</p>
        </div>
        <div class="catalog four">
{chr(10).join(card(*p) for p in specialist)}
        </div>
      </div>
    </div>
  </section>

  <section class="section bg-sky" aria-labelledby="help-title">
    <div class="wrap final">
      <span class="eyebrow">Talk to an Advisor</span>
      <h2 id="help-title">Not sure which program fits?</h2>
      <p class="lede">An advisor can help you compare programs based on your background or your team's goals.</p>
      <a class="btn btn-primary" href="index.html#enquire">Talk to an Advisor</a>
      <p style="color: var(--muted); font-size: 0.9rem">No prices are shown on the public website. Fees and schedules are discussed with an advisor.</p>
    </div>
  </section>'''

open("programs.html", "w", encoding="utf-8").write(page("Programs · ROICIANS TECH (prototype)", programs_body, "programs.html", "Prototype Programs listing for ROICIANS TECH."))

# ---------------------------------------------------------------- logo options (revision 2)
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

orig = sha("assets/brand/roicians-logo-original.png")
SYM = '<img class="sym" src="assets/brand/roicians-symbol.png" alt="" width="172" height="180">'
WM = '<img class="wm" src="assets/brand/roicians-wordmark.png" alt="" width="290" height="57">'
TAGLINE = "Practical technology training for the AI era."


def lock(opt, size, cobalt=False):
    cls = f"rt rt-{opt} {size}" + (" cobalt" if cobalt else "")
    return (f'<span class="{cls}" role="img" aria-label="ROICIANS TECH, option {opt}">'
            f'{SYM}<span class="name">{WM}<span class="tech">TECH</span></span></span>')


FAKE_NAV = '<span class="fake" aria-hidden="true"><i></i><i></i><i></i><i></i><u></u><b></b></span>'
OPTS = {
    1: ("Option 1", "TECH alongside the wordmark", "A smaller TECH follows ROICIANS on the same baseline, so the name reads in one line: ROICIANS TECH."),
    2: ("Option 2", "TECH beneath the end of the wordmark", "A smaller TECH sits under the end of ROICIANS, its right edge flush with the S, forming a compact two-line name block."),
}


def specimens(o):
    eb, title, desc = OPTS[o]
    tiles = "".join(
        f'<figure class="tile {bg}">{lock(o, "hd", cob)}<figcaption>{cap}</figcaption></figure>'
        for bg, cob, cap in [("white", False, "Navy TECH · white"), ("sky", False, "Navy TECH · soft blue"),
                             ("white", True, "Cobalt TECH · white"), ("sky", True, "Cobalt TECH · soft blue")])
    return f'''<article class="opt" aria-labelledby="o{o}-title">
          <span class="eyebrow">{eb}</span>
          <h3 id="o{o}-title">{title}</h3>
          <p class="opt-desc">{desc}</p>
          <div class="tiles">{tiles}</div>
        </article>'''


def header_mock(o, bg):
    return f'''<figure class="mock-fig"><figcaption>{OPTS[o][0]} · header on {"white" if bg == "white" else "soft blue"}</figcaption>
          <div class="mock-head {bg}"><div class="mock-bar">{lock(o, "hd")}{FAKE_NAV}</div></div></figure>'''


def footer_mock(o, bg):
    return f'''<div class="mock-foot {bg}">{lock(o, "ft")}<p class="tag">{TAGLINE}</p></div>'''


def phone(o):
    return f'''<figure class="phone-fig"><figcaption>{OPTS[o][0]} · 390 px phone</figcaption>
          <div class="phone">
            <div class="ph-bar">{lock(o, "ph")}<span class="ph-act" aria-hidden="true"><b>Log in</b><s><i></i><i></i><i></i></s></span></div>
            <div class="ph-body" aria-hidden="true"><i></i><i></i><i class="short"></i><b></b></div>
            <div class="ph-foot">{lock(o, "hd")}<p class="tag">{TAGLINE}</p></div>
          </div></figure>'''


logo_css = '''<style>
  .lk-section h2 { font-size: clamp(1.35rem, 1.15rem + 0.8vw, 1.75rem); margin-bottom: 6px; }
  .lk-section .sub { color: var(--muted); margin: 0 0 22px; max-width: 70ch; }
  .lk-section + .lk-section { padding-top: 0; }
  .cmp { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr)); }
  .opt { display: grid; gap: 12px; align-content: start; padding: clamp(20px, 3vw, 32px); border-radius: 24px; border: 1px solid var(--line); background: var(--white); min-width: 0; }
  .opt h3 { margin: 0; font-size: var(--fs-h3); }
  .opt-desc { margin: 0; color: var(--muted); }
  .tiles { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); margin-top: 8px; }
  .tile { margin: 0; display: grid; place-items: center; gap: 16px; min-height: 170px; padding: 28px 10px 14px; border-radius: 16px; min-width: 0; overflow: hidden; }
  .tile.white { background: var(--white); border: 1px solid var(--line); }
  .tile.sky { background: var(--sky); }
  .tile figcaption, .mock-fig figcaption, .phone-fig figcaption, .mock-foot-fig figcaption { font: 500 0.74rem/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .hero-spec { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr)); margin-bottom: 24px; }
  .hero-spec .tile { min-height: 230px; }
  @media (max-width: 600px) { .hero-spec .rt.xl { --wm: 26px; --sym: 58px; } }
  .mock-fig, .mock-foot-fig, .phone-fig { margin: 0; display: grid; gap: 8px; min-width: 0; }
  .mock-stack { display: grid; gap: 20px; }
  .mock-head { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .mock-head.white { background: var(--white); } .mock-head.sky { background: var(--sky); }
  .mock-bar { display: flex; align-items: center; gap: 28px; min-height: 80px; padding: 0 clamp(16px, 3vw, 32px); }
  .mock-bar .fake { margin-left: auto; display: flex; gap: clamp(14px, 2vw, 28px); align-items: center; min-width: 0; overflow: hidden; }
  .mock-bar .fake i { display: block; flex: none; width: 70px; height: 9px; border-radius: 5px; background: #D3DDEE; }
  .mock-bar .fake u { display: block; flex: none; width: 54px; height: 9px; border-radius: 5px; background: #C3D0E6; }
  .mock-bar .fake b { display: block; flex: none; width: 150px; height: 44px; border-radius: 999px; background: var(--cobalt); }
  @media (max-width: 1100px) { .mock-bar .fake i { display: none; } } @media (max-width: 860px) { .mock-bar .fake b { width: 110px; } } @media (max-width: 600px) { .mock-bar { gap: 16px; } .mock-bar .fake u { display: none; } .mock-bar .fake b { width: 44px; height: 36px; } }
  .mock-foot { display: grid; justify-items: start; gap: 16px; padding: 36px clamp(20px, 3vw, 36px); border-radius: 14px; min-width: 0; overflow: hidden; }
  .mock-foot.sky { background: var(--sky); } .mock-foot.white { background: var(--white); border: 1px solid var(--line); }
  .mock-foot .tag, .ph-foot .tag { margin: 0; color: var(--muted); max-width: 36ch; text-wrap: balance; }
  .phones { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; }
  .phone-fig { width: min(100%, 392px); }
  .phone { width: 100%; border: 1px solid var(--line); border-radius: 22px; overflow: hidden; background: var(--white); box-shadow: var(--shadow-soft); }
  .ph-bar { display: flex; align-items: center; gap: 12px; min-height: 68px; padding: 0 16px; border-bottom: 1px solid var(--line); }
  .ph-act { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .ph-act b { font: 600 0.88rem/1 var(--body); color: var(--navy); padding: 10px 12px; border: 1.5px solid #C6D3EC; border-radius: 999px; }
  .ph-act s { display: grid; gap: 4px; width: 40px; height: 40px; place-content: center; border-radius: 12px; background: var(--sky); }
  .ph-act s i { display: block; width: 18px; height: 2px; border-radius: 2px; background: var(--navy); }
  .ph-body { display: grid; gap: 10px; padding: 28px 16px 32px; background: linear-gradient(180deg, var(--white), var(--sky)); }
  .ph-body i { display: block; height: 14px; border-radius: 7px; background: #D3DDEE; } .ph-body i.short { width: 60%; }
  .ph-body b { display: block; width: 150px; height: 44px; border-radius: 999px; background: var(--cobalt); margin-top: 8px; }
  .ph-foot { display: grid; justify-items: start; gap: 14px; padding: 28px 16px; background: var(--sky); }
  .toggle { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--white); margin-bottom: 22px; }
  .toggle legend { float: left; font-weight: 600; margin-right: 6px; padding: 0; }
  .toggle label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .toggle input { accent-color: var(--cobalt); width: 18px; height: 18px; }
  .rec { display: grid; gap: 14px; padding: clamp(22px, 3vw, 34px); border-radius: 24px; background: var(--white); border: 1.5px solid #BFD0F2; }
  .rec h2 { margin: 0; }
  .rec ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
  .rec-spec { display: flex; flex-wrap: wrap; gap: 14px; }
  .rec-spec > div { display: grid; place-items: center; padding: 22px 26px; border-radius: 16px; background: var(--sky); flex: 1 1 260px; min-width: 0; overflow: hidden; }
  .rec-spec > div.white { background: var(--white); border: 1px solid var(--line); }
  @media (max-width: 600px) { .rec-spec > div { padding: 20px 14px; } .rec-spec .rt-1.ft { --wm: 22px; --sym: 50px; } }
  table.lk-table td:first-child { font-weight: 600; color: var(--navy); }
</style>'''

toggle_js = '''<script>
  (function () {
    var zone = document.getElementById("mockups");
    document.querySelectorAll('input[name="techcolour"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var cob = document.querySelector('input[name="techcolour"]:checked').value === "cobalt";
        zone.querySelectorAll(".rt").forEach(function (el) { el.classList.toggle("cobalt", cob); });
      });
    });
  })();
</script>'''

logo_body = f'''{logo_css}
  <section class="page-intro" aria-labelledby="logo-title">
    <div class="wrap">
      <p class="crumbs"><a href="index.html">Home</a> / Logo options</p>
      <h1 id="logo-title">ROICIANS TECH logo lockups, revision 2</h1>
      <p class="lede">Two modernised ways to add TECH to the original ROICIANS logo, shown side by side for your choice. The previous header and footer treatments are withdrawn. The original symbol and wordmark are unchanged.</p>
    </div>
  </section>

  <section class="section-tight lk-section" aria-labelledby="s-what">
    <div class="wrap">
      <h2 id="s-what">What changed from the rejected version</h2>
      <ul class="sub" style="padding-left:20px;display:grid;gap:6px">
        <li>No vertical divider, no horizontal rules and no underline.</li>
        <li>TECH is set in Instrument Sans SemiBold with minimal letter spacing (4–6 %), not widely spaced capitals.</li>
        <li>TECH is sized and placed from the wordmark itself: on its baseline (Option 1) or flush with the end of its S (Option 2). This makes the two words read as one name.</li>
        <li>One arrangement is used in the header, footer and on phones; only the size changes.</li>
        <li>The tagline stays outside the logo, as supporting footer copy.</li>
      </ul>
    </div>
  </section>

  <section class="section-tight lk-section" aria-labelledby="s-opts">
    <div class="wrap">
      <h2 id="s-opts">1. The two options</h2>
      <p class="sub">Large size first, then at header size in navy (the same colour as the logo) and with a cobalt accent, on white and on soft blue.</p>
      <div class="hero-spec">
        <figure class="tile white">{lock(1, "xl")}<figcaption>Option 1 · navy · white</figcaption></figure>
        <figure class="tile white">{lock(2, "xl")}<figcaption>Option 2 · navy · white</figcaption></figure>
      </div>
      <div class="cmp">
        {specimens(1)}
        {specimens(2)}
      </div>
    </div>
  </section>

  <div id="mockups">
  <section class="section-tight lk-section" aria-labelledby="s-head">
    <div class="wrap">
      <h2 id="s-head">2. Website header (desktop, actual size)</h2>
      <p class="sub">The real 80 px header height. Grey bars stand in for the menu, Log in and the call-to-action button.</p>
      <fieldset class="toggle"><legend>TECH colour in sections 2–4:</legend>
        <label><input type="radio" name="techcolour" value="navy" checked> Navy (same colour as the logo)</label>
        <label><input type="radio" name="techcolour" value="cobalt"> Cobalt accent</label>
      </fieldset>
      <div class="mock-stack">
        {header_mock(1, "white")}
        {header_mock(2, "white")}
        {header_mock(1, "sky")}
        {header_mock(2, "sky")}
      </div>
    </div>
  </section>

  <section class="section-tight lk-section" aria-labelledby="s-foot">
    <div class="wrap">
      <h2 id="s-foot">3. Footer (actual size)</h2>
      <p class="sub">The same arrangement as the header, larger, with the tagline as separate copy beneath it. The live footer uses the soft-blue background.</p>
      <div class="cmp">
        <figure class="mock-foot-fig"><figcaption>Option 1 · footer on soft blue and white</figcaption>{footer_mock(1, "sky")}{footer_mock(1, "white")}</figure>
        <figure class="mock-foot-fig"><figcaption>Option 2 · footer on soft blue and white</figcaption>{footer_mock(2, "sky")}{footer_mock(2, "white")}</figure>
      </div>
    </div>
  </section>

  <section class="section-tight lk-section" aria-labelledby="s-phone">
    <div class="wrap">
      <h2 id="s-phone">4. Phone (390 px wide)</h2>
      <p class="sub">The header bar on white and the footer on soft blue, with the real Log in button and menu button sizes and a 16 px side margin.</p>
      <div class="phones">
        {phone(1)}
        {phone(2)}
      </div>
    </div>
  </section>
  </div>

  <section class="section-tight lk-section" aria-labelledby="s-cmp">
    <div class="wrap">
      <h2 id="s-cmp">5. Comparison</h2>
      <div class="table-wrap"><table class="lk-table">
        <thead><tr><th></th><th>Option 1: TECH alongside</th><th>Option 2: TECH beneath</th></tr></thead>
        <tbody>
          <tr><td>How it reads</td><td>One line, in natural order: ROICIANS TECH</td><td>ROICIANS first, then TECH as a second line</td></tr>
          <tr><td>TECH text size: header / phone / footer</td><td>13.8 px / 10.7 px / 18.8 px</td><td>13.2 px / 10.5 px / 16.5 px</td></tr>
          <tr><td>Logo size: header</td><td>216 × 50 px</td><td>189 × 54 px</td></tr>
          <tr><td>Logo size: 390 px phone</td><td>168 × 40 px</td><td>151 × 44 px</td></tr>
          <tr><td>Strengths</td><td>Clearest name; TECH stays as large as possible at every size; slim header</td><td>Compact, tidy block; narrower</td></tr>
          <tr><td>Weaknesses</td><td>Wider (still fits a 390 px phone header with Log in and the menu button)</td><td>TECH must be smaller to sit under the wordmark, and reads more like a sub-label than part of the name</td></tr>
        </tbody>
      </table></div>
    </div>
  </section>

  <section class="section-tight lk-section" aria-labelledby="s-rec">
    <div class="wrap">
      <div class="rec">
        <span class="eyebrow">Recommendation</span>
        <h2 id="s-rec">Option 1, with TECH in the same navy as the logo</h2>
        <div class="rec-spec">
          <div class="white">{lock(1, "hd")}</div>
          <div>{lock(1, "ft")}</div>
        </div>
        <ul>
          <li><strong>One arrangement everywhere:</strong> symbol, ROICIANS, TECH, in one line, in the header, the footer and on phones. Only the size changes. Sizes (symbol / wordmark height): header 50 / 22 px; phone header 40 / 17 px; footer 68 / 30 px (50 / 22 px on phones).</li>
          <li><strong>Why Option 1:</strong> it reads as one name, ROICIANS TECH, in natural order; TECH stays legible on a phone; and the header stays slim.</li>
          <li><strong>Why navy rather than cobalt:</strong> a single colour keeps ROICIANS and TECH together as one identity. A cobalt TECH is fresh, but it makes TECH look like a separate label. Cobalt stays for buttons and links.</li>
          <li><strong>Footer:</strong> the logo, then the tagline "Practical technology training for the AI era" as ordinary text beneath it, not part of the logo.</li>
          <li><strong>Nothing is applied yet.</strong> The prototype's header and footer still show the withdrawn treatment until you choose. Once you choose, only the header and footer logo change.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="section-tight bg-sky" aria-labelledby="logo-rules">
    <div class="wrap doc">
      <h2 id="logo-rules" style="margin-top:0">How the original logo is preserved</h2>
      <ul>
        <li><strong>Master file unchanged:</strong> <code>docs/brand/roicians-logo-original.png</code>, 433 × 370 transparent PNG, SHA-256 <code>{orig[:16]}…</code>.</li>
        <li><strong>Symbol and wordmark:</strong> <code>roicians-symbol.png</code> and <code>roicians-wordmark.png</code> are straight crops of the original. Their pixels and colour are not changed. Each is scaled evenly by the browser, never stretched.</li>
        <li><strong>TECH:</strong> live text in Instrument Sans SemiBold (Inter as fallback), letter spacing 0.04em (Option 1) or 0.06em (Option 2). The colour is the original logo navy <code>#2E496C</code>, with cobalt <code>#2347D0</code> shown only as an alternative.</li>
        <li><strong>Alignment:</strong> TECH's size and position come from measurements of the wordmark (cap height 39 of 57 px; baseline 43 px from the top; the S ends 5 px from the right edge). Alignment therefore holds at every size.</li>
        <li><strong>Backgrounds:</strong> white or soft blue only, never dark.</li>
        <li><strong>Resolution:</strong> the supplied PNG is small. It is sharp at header and footer sizes. A vector (SVG) or larger master is recommended before launch, and before using the logo larger than about 40 px wordmark height.</li>
      </ul>
    </div>
  </section>
{toggle_js}'''
open("logo-options.html", "w", encoding="utf-8").write(page("Logo options · ROICIANS TECH (prototype)", logo_body, None, "Two revised ROICIANS TECH logo lockups, side by side, using the original ROICIANS logo."))

# ---------------------------------------------------------------- review notes
imgs = [
    ("hero-career.svg", "Hero slide 1: code editor, test run and learning path"),
    ("hero-corporate.svg", "Hero slide 2: team session, cohort plan and skills map"),
    ("hero-ai.svg", "Hero slide 3: prompt, knowledge store, model, evaluation and agent steps"),
    ("corporate-session.svg", "Corporate Training section"),
    ("institutions.svg", "For Institutions section"),
] + [(p[1], "Program card: " + p[0].replace("&amp;", "&")) for p in career + specialist]
rows = "\n".join(f'<tr><td><code>{f}</code></td><td>{html.escape(u)}</td><td>Original illustration created for this prototype</td><td>Owned by the project; no third-party licence</td></tr>' for f, u in imgs)
notes_body = f'''  <section class="page-intro" aria-labelledby="notes-title">
    <div class="wrap">
      <p class="crumbs"><a href="index.html">Home</a> / Review notes</p>
      <h1 id="notes-title">Prototype review notes</h1>
      <p class="lede">What is approved, what is sample, which actions are prototype-only, and where every image comes from.</p>
    </div>
  </section>
  <section class="section" aria-label="Review notes">
    <div class="wrap doc">
      <h2 style="margin-top:0">Approved content used</h2>
      <ul>
        <li>The public brand name ROICIANS TECH, the line "Practical technology training for the AI era" and the original ROICIANS logo (supplied by the owner).</li>
        <li>The ten Program names and the two initial groups: Career &amp; Technology Programs, Specialist &amp; Professional Programs.</li>
        <li>Button labels Talk to an Advisor, Explore Programs and Join Interest List, and the state "Next Cohort: Coming Soon".</li>
        <li>Online-first delivery with room for in-person or hybrid formats.</li>
        <li>Rules: no public prices, fees, seat counts, capacity or private Batch details; no invented Batch dates.</li>
        <li>Colour palette: white #FFFFFF, soft blue #F1F6FF, cobalt #2347D0, dark navy #14263F, plus the original logo blue #2E496C as a supporting colour.</li>
      </ul>

      <h2>Owner decisions so far (provisional, 2026-10-22)</h2>
      <p>These approve the branding direction provisionally. They are not final approval of the whole visual prototype.</p>
      <ul>
        <li>The original logo artwork and navy colour are preserved: no redesign or recolouring.</li>
        <li><strong>Logo lockups withdrawn:</strong> the earlier header Option B (divider and widely spaced TECH) and footer Option A (TECH between rules) are no longer approved. Two revised lockups are on the <a href="logo-options.html">logo options</a> page for your choice. Until then the header and footer still show the withdrawn version.</li>
        <li>Palette stays white, soft blue and cobalt.</li>
        <li>The original topic-specific illustrations stay on the Program cards in the prototype.</li>
        <li>For the live website: a limited amount of properly licensed professional photography in the hero and Corporate Training sections (not yet sourced).</li>
        <li>"Start with a program in demand" is replaced by "Explore our technology programs". A demand claim needs independent substantiation before it can be used.</li>
      </ul>

      <h2>Sample copy (not approved launch content)</h2>
      <ul>
        <li>All headlines, slide text, value-proposition text, Program descriptions, group descriptions, Corporate Training and For Institutions text.</li>
        <li>Featured Programs on the homepage (testing, data analytics, cybersecurity, generative AI and LLMOps) are a provisional choice for layout only, not an approved order.</li>
        <li>"GenAI &amp; LLMOps for GCC Teams" is the design's example Corporate Training audience.</li>
        <li>Section headings such as "Explore our technology programs", "Training shaped around your teams" and "Not sure which program fits?" are sample wording.</li>
        <li>Statements that would need evidence before launch: any claim about demand, outcomes, placement, employers or numbers. None are used in this prototype.</li>
      </ul>

      <h2>Prototype-only actions</h2>
      <ul>
        <li>Explore Program, About, Student and Trainer login, certificate verification, Privacy and Terms show a short note instead of navigating.</li>
        <li>Talk to an Advisor scrolls to the enquiry section. Its button shows a note that nothing is sent; no submission is simulated.</li>
        <li>Join Interest List shows a note; the form arrives with the enquiry pages (Phase 22H).</li>
        <li>Working: navigation, the Programs page and its group filter, the hero slider (arrows, indicators, keyboard arrows, swipe), the Featured Programs carousel, the mobile menu and the Log in menu.</li>
      </ul>

      <h2>Images: sources and licensing</h2>
      <p>No stock photography or third-party images are used. Every image is an original illustration generated for this prototype from basic shapes by the script <code>gen_illustrations.py</code>, which is kept with the prototype files. There are no real people, client logos or AI robots. Silhouettes in the team illustrations are generic and do not depict actual ROICIANS clients, instructors or students.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>File</th><th>Used for</th><th>Source</th><th>Licence</th></tr></thead>
        <tbody>
{rows}
        <tr><td><code>roicians-logo-*.png</code></td><td>Header and footer logo</td><td>Original ROICIANS logo supplied by the owner (2026-10-22)</td><td>Owner's brand asset</td></tr>
        </tbody>
      </table></div>
      <p style="margin-top:12px">Fonts: Instrument Sans, Inter and Geist Mono from Google Fonts, under the SIL Open Font License.</p>
      <p>If photography is wanted for launch, it should come from a licensed library or a commissioned shoot, with releases for any recognisable people.</p>

      <h2>Not shown on purpose</h2>
      <ul>
        <li>No testimonials, student counts, employer or partner logos, placement results or Batch dates (none approved).</li>
        <li>No dark backgrounds, heavy gradients, glow effects or generic AI imagery.</li>
        <li>The Admin login is not promoted on the public site.</li>
      </ul>
    </div>
  </section>'''
open("notes.html", "w", encoding="utf-8").write(page("Review notes · ROICIANS TECH (prototype)", notes_body, None, "Review notes for the ROICIANS TECH website prototype."))
print("built programs.html, logo-options.html, notes.html")
