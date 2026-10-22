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

# ---------------------------------------------------------------- logo options
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

orig = sha("assets/brand/roicians-logo-original.png")
lockB = '''<span class="brand-h" style="pointer-events:none">
            <img class="sym" src="assets/brand/roicians-symbol.png" alt="" width="172" height="180">
            <span class="word"><img class="wm" src="assets/brand/roicians-wordmark.png" alt="ROICIANS" width="290" height="57"><span class="rule" aria-hidden="true"></span><span class="tech">TECH</span></span>
          </span>'''
lockA = '''<span class="brand-s">
            <img src="assets/brand/roicians-logo-web.png" alt="ROICIANS" width="293" height="260">
            <span class="tech-row"><span class="tech">TECH</span></span>
          </span>'''
logo_css = '''<style>
  .opt { display: grid; gap: 22px; padding: clamp(24px, 4vw, 40px); border-radius: 28px; border: 1px solid var(--line); background: var(--white); }
  .opt + .opt { margin-top: 36px; }
  .stage { display: grid; place-items: center; min-height: 260px; border-radius: 20px; padding: 32px 20px; }
  .stage.white { background: var(--white); border: 1px dashed #CBD7EC; }
  .stage.sky { background: var(--sky); }
  .stages { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
  .stage, .mock { min-width: 0; overflow: hidden; }
  .big .brand-s img { width: 220px; } .big .brand-s .tech { font-size: 1.3rem; }
  .big .brand-h .sym { height: 84px; } .big .brand-h .wm { height: 34px; } .big .brand-h .rule { height: 34px; width: 2px; } .big .brand-h .tech { font-size: 1.7rem; }
  .mock { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--white); }
  .mock-bar { display: flex; align-items: center; gap: 18px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
  .mock-bar .fake { margin-left: auto; display: flex; gap: 10px; align-items: center; min-width: 0; flex-shrink: 1; overflow: hidden; }
  .mock-bar > .brand-h, .mock-bar > .brand-s { flex: none; }
  .mock-bar .fake i { display: block; width: 52px; height: 9px; border-radius: 5px; background: #DCE5F3; }
  .mock-bar .fake i { flex: 0 1 44px; }
  .mock-bar .fake b { display: block; flex: none; width: 92px; height: 30px; border-radius: 999px; background: var(--cobalt); }
  .mock.phone { max-width: 390px; }
  .mock.phone .fake i { display: none; } .mock.phone .fake b { width: 64px; background: #DCE5F3; }
  .mock .brand-s img { width: 92px; } .mock .brand-s .tech { font-size: 0.72rem; } .mock .brand-s { gap: 6px; }
  .mock.phone .brand-h .sym { height: 36px; } .mock.phone .brand-h .wm { height: 14px; } .mock.phone .brand-h .tech { font-size: 0.75rem; } .mock.phone .brand-h .rule { height: 14px; }
  .mock.phone .brand-s img { width: 70px; }
  .opt h2 { margin: 0; }
  .facts { display: grid; gap: 8px; color: var(--muted); padding-left: 20px; margin: 0; }
</style>'''
logo_body = f'''{logo_css}
  <section class="page-intro" aria-labelledby="logo-title">
    <div class="wrap">
      <p class="crumbs"><a href="index.html">Home</a> / Logo options</p>
      <h1 id="logo-title">Website logo layouts</h1>
      <p class="lede">Two website-only arrangements of the original ROICIANS logo with TECH added as a supporting label. The original artwork is not redrawn, recoloured or distorted. Choose one for the header.</p>
    </div>
  </section>

  <section class="section" aria-label="Logo options">
    <div class="wrap">
      <div class="opt" aria-labelledby="opt-a">
        <span class="eyebrow">Option A</span>
        <h2 id="opt-a">Stacked: original logo with TECH beneath</h2>
        <div class="stages big">
          <div class="stage white">{lockA}</div>
          <div class="stage sky">{lockA}</div>
        </div>
        <div class="stages">
          <div class="mock"><div class="mock-bar">{lockA}<span class="fake"><i></i><i></i><i></i><b></b></span></div></div>
          <div class="mock phone"><div class="mock-bar">{lockA}<span class="fake"><b></b></span></div></div>
        </div>
        <ul class="facts">
          <li>Best for the footer, social images and printed materials, where there is vertical room.</li>
          <li>In a header it needs about twice the height of Option B, which pushes the page content down, especially on phones.</li>
        </ul>
      </div>

      <div class="opt" aria-labelledby="opt-b">
        <span class="eyebrow">Option B · used in the prototype header</span>
        <h2 id="opt-b">Horizontal: original symbol, original wordmark, then TECH</h2>
        <div class="stages big">
          <div class="stage white">{lockB}</div>
          <div class="stage sky">{lockB}</div>
        </div>
        <div class="stages">
          <div class="mock"><div class="mock-bar">{lockB}<span class="fake"><i></i><i></i><i></i><b></b></span></div></div>
          <div class="mock phone"><div class="mock-bar">{lockB}<span class="fake"><b></b></span></div></div>
        </div>
        <ul class="facts">
          <li>Compact enough for a sticky header on desktop and on a 390px phone.</li>
          <li>The symbol and the wordmark are cropped from the original artwork and scaled evenly; neither is redrawn.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="section-tight bg-sky" aria-labelledby="logo-rules">
    <div class="wrap doc">
      <h2 id="logo-rules" style="margin-top:0">How the original logo is preserved</h2>
      <ul>
        <li><strong>Master file kept unchanged:</strong> <code>docs/brand/roicians-logo-original.png</code>, 433 × 370 transparent PNG, SHA-256 <code>{orig[:16]}…</code>.</li>
        <li><strong>Web copy:</strong> <code>roicians-logo-web.png</code> only trims the empty transparent margin.</li>
        <li><strong>Header pieces:</strong> <code>roicians-symbol.png</code> and <code>roicians-wordmark.png</code> are straight crops of the original. Pixels are not changed or resampled.</li>
        <li><strong>TECH:</strong> set in Instrument Sans, semibold, widely letter-spaced, in the original logo blue <code>#2E496C</code>, so it reads as a supporting label rather than part of the mark.</li>
        <li><strong>Backgrounds:</strong> the navy logo is used only on white or very light blue, never on dark backgrounds.</li>
        <li><strong>Resolution:</strong> the supplied PNG is small. It is sharp at header and footer sizes, but a vector (SVG) or larger master is recommended before launch.</li>
      </ul>
    </div>
  </section>'''
open("logo-options.html", "w", encoding="utf-8").write(page("Logo options · ROICIANS TECH (prototype)", logo_body, None, "Two website-only logo layouts using the original ROICIANS logo."))

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
        <li>Header: logo Option B (horizontal). Footer: logo Option A (stacked).</li>
        <li>The original logo artwork and navy colour are preserved: no redesign or recolouring.</li>
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
