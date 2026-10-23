"""Builds programs.html, logo.html and notes.html for the ROICIANS
website prototype v2, reusing the header and footer from index.html so that
navigation is identical on every page. Run from this folder: python3 build_pages.py"""
import re, hashlib, html

# Public brand configuration: the single place the prototype's public brand is set.
# The public brand is kept separate from the legal identity. Changing the public name
# here (and in index.html, which check_brand() verifies) updates every generated page.
# This mirrors the planned app design (design doc section 4.1), where the name lives in
# one Company Settings field rather than in code.
BRAND = {
    "name": "ROICIANS",                                    # public brand name (owner decision, 2026-10-22)
    "tagline": "Practical technology training for the AI era.",
    "legal_name": "Roicians Tech Pvt. Ltd.",               # legal identity: never derived from the brand
}
B = BRAND["name"]

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
<link rel="icon" type="image/png" sizes="180x180" href="assets/brand/roicians-favicon.png">
<link rel="apple-touch-icon" href="assets/brand/roicians-touch-icon.png">
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

open("programs.html", "w", encoding="utf-8").write(page(f"Programs · {B} (prototype)", programs_body, "programs.html", f"Prototype Programs listing for {B}."))

# ---------------------------------------------------------------- website logo (decision page)
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

orig = sha("assets/brand/roicians-logo-original.png")
HDR = '''<span class="brand-h" role="img" aria-label="ROICIANS">
            <img class="sym" src="assets/brand/roicians-symbol.png" alt="" width="172" height="180">
            <img class="wm" src="assets/brand/roicians-wordmark.png" alt="" width="290" height="57">
          </span>'''
FTR = '<span class="brand-s" role="img" aria-label="ROICIANS"><img src="assets/brand/roicians-logo-web.png" alt="" width="293" height="260"></span>'
TAG = BRAND["tagline"]
logo_css = '''<style>
  .lg-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
  .lg-tile { margin: 0; display: grid; place-items: center; gap: 18px; min-height: 200px; padding: 32px 16px 16px; border-radius: 18px; min-width: 0; overflow: hidden; }
  .lg-tile.white { background: var(--white); border: 1px solid var(--line); } .lg-tile.sky { background: var(--sky); }
  .lg-tile figcaption, .fav-row figcaption { font: 500 0.74rem/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .lg-tile .stack { display: grid; justify-items: start; gap: 16px; }
  .lg-tile .stack p { margin: 0; color: var(--muted); max-width: 30ch; }
  .lg-section h2 { font-size: clamp(1.35rem, 1.15rem + 0.8vw, 1.75rem); margin-bottom: 18px; }
  .lg-section + .lg-section { padding-top: 0; }
  .fav-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: stretch; }
  .fav-row figure { margin: 0; display: grid; gap: 12px; place-items: center; padding: 20px; border-radius: 18px; border: 1px solid var(--line); background: var(--white); flex: 1 1 200px; }
  .tab { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px 10px 0 0; background: var(--sky-2); font: 500 0.82rem/1 var(--body); color: var(--navy); }
  .tab img { width: 16px; height: 16px; }
  .sizes { display: flex; gap: 18px; align-items: end; }
  .touch { width: 76px; height: 76px; border-radius: 17px; box-shadow: var(--shadow-soft); }
</style>'''
logo_body = f'''{logo_css}
  <section class="page-intro" aria-labelledby="logo-title">
    <div class="wrap">
      <p class="crumbs"><a href="index.html">Home</a> / Website logo</p>
      <h1 id="logo-title">Website logo</h1>
      <p class="lede">Owner decision (2026-10-22): the website uses the original ROICIANS logo on its own, with no TECH, dividers or extra lettering.</p>
    </div>
  </section>

  <section class="section-tight lg-section" aria-labelledby="lg-use">
    <div class="wrap">
      <h2 id="lg-use">How the logo is used</h2>
      <div class="lg-grid">
        <figure class="lg-tile white">{HDR}<figcaption>Header · white · desktop size</figcaption></figure>
        <figure class="lg-tile sky">{HDR}<figcaption>Header · soft blue</figcaption></figure>
        <figure class="lg-tile sky"><span class="stack">{FTR}<p>{TAG}</p></span><figcaption>Footer · soft blue · tagline as normal text</figcaption></figure>
        <figure class="lg-tile white"><span class="stack">{FTR}<p>{TAG}</p></span><figcaption>Footer · white</figcaption></figure>
      </div>
    </div>
  </section>

  <section class="section-tight lg-section" aria-labelledby="lg-fav">
    <div class="wrap">
      <h2 id="lg-fav">Favicon: the R symbol alone</h2>
      <div class="fav-row">
        <figure><span class="tab"><img src="assets/brand/roicians-favicon.png" alt="">{B}</span><figcaption>Browser tab, 16 px</figcaption></figure>
        <figure><span class="sizes"><img src="assets/brand/roicians-favicon.png" alt="" width="16" height="16"><img src="assets/brand/roicians-favicon.png" alt="" width="32" height="32"><img src="assets/brand/roicians-favicon.png" alt="" width="48" height="48"></span><figcaption>16, 32 and 48 px</figcaption></figure>
        <figure><img class="touch" src="assets/brand/roicians-touch-icon.png" alt=""><figcaption>Phone home-screen icon</figcaption></figure>
      </div>
    </div>
  </section>

  <section class="section-tight bg-sky" aria-labelledby="logo-rules">
    <div class="wrap doc">
      <h2 id="logo-rules" style="margin-top:0">How the original logo is preserved</h2>
      <ul>
        <li><strong>Master file unchanged:</strong> <code>docs/brand/roicians-logo-original.png</code>, 433 × 370 transparent PNG, SHA-256 <code>{orig[:16]}…</code>.</li>
        <li><strong>Header:</strong> <code>roicians-symbol.png</code> and <code>roicians-wordmark.png</code> are straight crops of the original, placed side by side. Both are shown at the same scale as in the original logo, so their relative size is unchanged: the symbol is 56 px tall on desktop and 46 px on phones. The wordmark's letters are centred on the symbol.</li>
        <li><strong>Footer:</strong> <code>roicians-logo-web.png</code> is the original stacked logo with only its empty transparent margin trimmed. It is 140 px wide on desktop and 124 px on phones.</li>
        <li><strong>Favicon:</strong>
          <ul>
            <li><code>roicians-favicon.png</code> is the original symbol's pixels on a transparent 180 × 180 square.</li>
            <li><code>roicians-touch-icon.png</code> is the same on white, because phones show a transparent home-screen icon on black.</li>
            <li>Browsers scale it down for the tab. The thin lines of the R are light at 16 px, so a vector (SVG) master would sharpen it.</li>
          </ul></li>
        <li><strong>Colour and proportions:</strong> the original navy (about <code>#2E496C</code>). Nothing is recoloured, redrawn, stretched or squeezed; the images ignore the site-wide image width limit, so they can never be distorted.</li>
        <li><strong>Backgrounds:</strong> white or soft blue only, never dark.</li>
        <li><strong>Resolution:</strong> sharp at these sizes. A vector (SVG) or larger master is still recommended before launch.</li>
      </ul>

      <h2>Scope of this decision</h2>
      <ul>
        <li>The logo decision covers the website logo only.</li>
        <li><strong>Public brand name (owner decision, later on 2026-10-22):</strong> the India website's public brand is <strong>{B}</strong>, used consistently in page titles, labels, navigation and future SEO metadata.</li>
        <li>The legal company name stays <strong>{BRAND["legal_name"]}</strong>, as shown in the footer. Approved legal information, the LMS, the domain plans and the Canada website are unchanged.</li>
      </ul>

      <h2>Review history</h2>
      <ol>
        <li><strong>Header Option B and footer Option A</strong> (provisionally chosen, then withdrawn). TECH sat after a vertical divider in the header and between horizontal rules in the footer; the owner found this dated and inconsistent. Commit <code>8db3c00</code>.</li>
        <li><strong>Revision 2, two TECH lockups</strong> (not adopted). TECH sat alongside the wordmark, or beneath its end. Commit <code>745c8df</code>.</li>
        <li><strong>Decision:</strong> no TECH in the logo. The original ROICIANS logo is used on its own (this page).</li>
      </ol>
      <p>Earlier versions remain in the repository history. For example, <code>git show 745c8df:docs/prototypes/website-v2/logo-options.html</code> shows the revision-2 page. The full record is in <code>docs/brand/WEBSITE_LOGO_DECISIONS.md</code>.</p>
    </div>
  </section>'''
open("logo.html", "w", encoding="utf-8").write(page(f"Website logo · {B} (prototype)", logo_body, None, "The website logo decision: the original ROICIANS logo without TECH."))

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
        <li>The public brand name {B} (owner decision, 2026-10-22), the line "{BRAND["tagline"].rstrip(".")}", the legal name {BRAND["legal_name"]} and the original ROICIANS logo (supplied by the owner).</li>
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
        <li><strong>Website logo (decision, 2026-10-22):</strong> the original ROICIANS logo without TECH. The header uses the original R symbol and wordmark side by side. The footer uses the original stacked logo, with the tagline as normal text beneath it. The R symbol alone is the favicon. See <a href="logo.html">Website logo</a>.</li>
        <li>The earlier TECH lockups (header Option B, footer Option A and the two revision-2 options) are no longer used. They remain in the review history.</li>
        <li><strong>Public brand name (decision, 2026-10-22):</strong> the India website's public brand is <strong>{B}</strong>, replacing the earlier name <span data-history>ROICIANS TECH</span>. It is used for page titles, branding labels, navigation and future SEO metadata. The tagline stays "{BRAND["tagline"].rstrip(".")}".</li>
        <li>The legal company name stays <strong>{BRAND["legal_name"]}</strong>, used for the copyright line and legal information. The LMS, legal company settings, historical records, the database, the domain plans and the Canada website are unchanged.</li>
        <li><strong>Changing the name later:</strong> the future website reads the public brand name from one setting (design doc §4.1), so a rename needs no code edits across components and no database migration. In this prototype, the name is set once in <code>build_pages.py</code> (<code>BRAND</code>).</li>
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
        <tr><td><code>roicians-*.png</code></td><td>Header and footer logo, favicon</td><td>Original ROICIANS logo supplied by the owner (2026-10-22)</td><td>Owner's brand asset</td></tr>
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
open("notes.html", "w", encoding="utf-8").write(page(f"Review notes · {B} (prototype)", notes_body, None, f"Review notes for the {B} website prototype."))


# ---------------------------------------------------------------- brand consistency check
def check_brand():
    """Fail the build if a page drifts from BRAND: wrong title, an old brand name, or a
    missing tagline or legal name."""
    legal = BRAND["legal_name"]
    for f in ["index.html", "programs.html", "logo.html", "notes.html"]:
        s = open(f, encoding="utf-8").read()
        title = re.search(r"<title>(.*?)</title>", s).group(1)
        assert B in title, f"{f}: title does not use the public brand: {title}"
        visible = re.sub(r"<span data-history>.*?</span>", "", s.replace(legal, ""))  # marked decision-history text is allowed
        assert not re.search(r"ROICIANS TECH|Roicians Tech(?! Pvt)", visible), f"{f}: old public brand name found"
        assert legal in s, f"{f}: legal name missing"
        assert BRAND["tagline"] in s, f"{f}: tagline missing"


check_brand()
print(f"built programs.html, logo.html, notes.html (public brand: {B}; legal name: {BRAND['legal_name']})")
