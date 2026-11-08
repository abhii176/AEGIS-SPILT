#!/usr/bin/env python3
"""Generate docs/Aegis-Split.pdf — product overview for Aegis-Split."""

from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfgen import canvas

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO_ROOT / "docs" / "Aegis-Split.pdf"

# Brand palette — restrained, professional
NAVY = colors.HexColor("#1a365d")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748b")
ACCENT = colors.HexColor("#2563eb")
LIGHT_BG = colors.HexColor("#f8fafc")
RULE = colors.HexColor("#e2e8f0")


class NumberedCanvas(canvas.Canvas):
    """Footer with page number and document title."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, page_count: int):
        self.saveState()
        self.setStrokeColor(RULE)
        self.setLineWidth(0.5)
        self.line(0.85 * inch, 0.65 * inch, letter[0] - 0.85 * inch, 0.65 * inch)
        self.setFont("Helvetica", 8)
        self.setFillColor(MUTED)
        self.drawString(0.85 * inch, 0.45 * inch, "Aegis-Split — Escrow for freelance work")
        self.drawRightString(
            letter[0] - 0.85 * inch,
            0.45 * inch,
            f"Page {self._pageNumber} of {page_count}",
        )
        self.restoreState()


def _header_band(c: canvas.Canvas, doc):
    """Draw top accent bar on inner pages."""
    if c._pageNumber == 1:
        return
    c.saveState()
    c.setFillColor(NAVY)
    c.rect(0, letter[1] - 0.22 * inch, letter[0], 0.22 * inch, fill=1, stroke=0)
    c.restoreState()


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "DocTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            textColor=NAVY,
            spaceAfter=6,
        ),
        "subtitle": ParagraphStyle(
            "DocSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12,
            leading=16,
            textColor=MUTED,
            spaceAfter=20,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=NAVY,
            spaceBefore=14,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=SLATE,
            spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            leftIndent=14,
            bulletIndent=0,
            textColor=SLATE,
            spaceAfter=4,
        ),
        "mono": ParagraphStyle(
            "Mono",
            parent=base["Code"],
            fontName="Courier",
            fontSize=9,
            leading=12,
            textColor=SLATE,
            backColor=LIGHT_BG,
            borderPadding=6,
            spaceAfter=8,
        ),
        "flow_step": ParagraphStyle(
            "FlowStep",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            leftIndent=22,
            textColor=SLATE,
            spaceAfter=6,
        ),
    }
    return styles


def draw_architecture_diagram(c: canvas.Canvas, x: float, y: float, w: float, h: float):
    """Vector architecture diagram: Client, Freelancer, App, PayPal, GitHub, AI auditor."""
    c.saveState()

    box_h = 0.52 * inch
    box_w = 1.35 * inch
    cx = x + w / 2

    def rounded_box(bx, by, label, sub=None, fill=colors.white, stroke=ACCENT):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.setLineWidth(1.2)
        c.roundRect(bx, by, box_w, box_h, 6, fill=1, stroke=1)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 9)
        tw = c.stringWidth(label, "Helvetica-Bold", 9)
        c.drawString(bx + (box_w - tw) / 2, by + box_h / 2 + (4 if sub else -3), label)
        if sub:
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7)
            sw = c.stringWidth(sub, "Helvetica", 7)
            c.drawString(bx + (box_w - sw) / 2, by + box_h / 2 - 10, sub)

    def arrow(x1, y1, x2, y2, label=None):
        c.setStrokeColor(MUTED)
        c.setLineWidth(0.9)
        c.line(x1, y1, x2, y2)
        # arrowhead
        import math

        angle = math.atan2(y2 - y1, x2 - x1)
        alen = 6
        c.line(x2, y2, x2 - alen * math.cos(angle - 0.4), y2 - alen * math.sin(angle - 0.4))
        c.line(x2, y2, x2 - alen * math.cos(angle + 0.4), y2 - alen * math.sin(angle + 0.4))
        if label:
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.5)
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            c.drawCentredString(mx, my + 4, label)

    # Title
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y + h - 0.15 * inch, "System architecture (high level)")

    # Row 1: Client | Aegis-Split | Freelancer
    row1_y = y + h - 1.1 * inch
    client_x = x + 0.15 * inch
    app_x = cx - box_w / 2
    free_x = x + w - box_w - 0.15 * inch

    rounded_box(client_x, row1_y, "Client", "funds vault", fill=colors.HexColor("#eff6ff"))
    rounded_box(app_x, row1_y, "Aegis-Split", "Node / Express", fill=colors.HexColor("#f0fdf4"), stroke=colors.HexColor("#16a34a"))
    rounded_box(free_x, row1_y, "Freelancer", "ships PR", fill=colors.HexColor("#eff6ff"))

    arrow(client_x + box_w, row1_y + box_h / 2, app_x, row1_y + box_h / 2, "milestones")
    arrow(app_x + box_w, row1_y + box_h / 2, free_x, row1_y + box_h / 2, "work")

    # Row 2: PayPal, GitHub, AI auditor below app
    row2_y = y + 0.55 * inch
    gap = (w - 3 * box_w) / 4
    paypal_x = x + gap
    github_x = cx - box_w / 2
    ai_x = x + w - box_w - gap

    rounded_box(paypal_x, row2_y, "PayPal", "Orders / Payouts", stroke=colors.HexColor("#003087"))
    rounded_box(github_x, row2_y, "GitHub", "webhooks + PR", stroke=colors.HexColor("#24292f"))
    rounded_box(ai_x, row2_y, "AI auditor", "criteria vs diff", stroke=colors.HexColor("#7c3aed"))

    app_cx = app_x + box_w / 2
    app_bot = row1_y
    mid_y = (row1_y + row2_y + box_h) / 2

    arrow(app_cx, app_bot, paypal_x + box_w / 2, row2_y + box_h, "escrow")
    arrow(app_cx, app_bot, github_x + box_w / 2, row2_y + box_h, "merge")
    arrow(github_x + box_w / 2, row2_y + box_h, ai_x + box_w / 2, row2_y + box_h, "diff")
    arrow(ai_x + box_w / 2, row2_y + box_h, app_cx, row1_y + box_h / 2, "pass → pay")

    # Postgres hint under app
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(app_cx, row2_y - 0.12 * inch, "PostgreSQL (Prisma)")

    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.roundRect(x, y, w, h, 4, fill=0, stroke=1)

    c.restoreState()


def architecture_flowable(width, height=3.35 * inch):
    from reportlab.platypus import Flowable

    class ArchDiagram(Flowable):
        def __init__(self, w, h):
            Flowable.__init__(self)
            self.width = w
            self.height = h

        def draw(self):
            draw_architecture_diagram(self.canv, 0, 0, self.width, self.height)

    return ArchDiagram(width, height)


def build_story(styles):
    story = []
    content_w = letter[0] - 1.7 * inch

    story.append(Spacer(1, 0.35 * inch))
    story.append(Paragraph("Aegis-Split", styles["title"]))
    story.append(
        Paragraph(
            "Escrow marketplace: clients fund milestones via PayPal, freelancers deliver on GitHub, "
            "and an AI auditor verifies work before payout.",
            styles["subtitle"],
        )
    )
    story.append(Spacer(1, 0.1 * inch))

    # --- 1. The problem ---
    story.append(Paragraph("1. The problem", styles["h1"]))
    story.append(
        Paragraph(
            "Freelance and contract work often fails on trust. Clients worry about paying upfront "
            "and getting ghosted or low-quality deliverables. Freelancers worry about finishing work "
            "and never being paid — chasing invoices, disputing chargebacks, or learning that the "
            "client disappeared after handoff.",
            styles["body"],
        )
    )
    story.append(
        Paragraph(
            "Traditional invoicing does not tie payment to proof of completion. Escrow helps, but "
            "manual escrow is slow and opaque. Aegis-Split automates the loop: agreed milestones, "
            "locked funds, verifiable delivery on GitHub, machine-assisted review against acceptance "
            "criteria, and release only when checks pass.",
            styles["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Who it helps:</b> Product teams hiring contractors, agencies with milestone billing, "
            "and individual freelancers who want payment tied to objective delivery signals rather "
            "than email promises.",
            styles["body"],
        )
    )

    # --- 2. How escrow works ---
    story.append(Paragraph("2. How escrow works", styles["h1"]))
    steps = [
        ("Agree", "Client and freelancer create a project with milestones — task, acceptance criteria, and amount."),
        ("Verify", "Both parties complete identity verification and monitoring consent (required before funding or linking code)."),
        ("Fund", "Client pays via PayPal Orders API. Funds are captured into the vault; money is locked, not paid out yet."),
        ("Build", "Freelancer links a GitHub repository and pull request to the milestone, then merges when ready."),
        ("Audit", "On merge, Aegis-Split fetches the PR diff, runs the AI auditor against acceptance criteria, and records pass or fail."),
        ("Pay", "If the audit passes, PayPal Payouts releases that milestone’s amount to the freelancer; both sides get notifications."),
    ]
    for i, (title, desc) in enumerate(steps, start=1):
        story.append(
            Paragraph(
                f"<b>{i}. {title}</b> — {desc}",
                styles["flow_step"],
            )
        )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "The same cycle repeats for each milestone until the project is complete. Funds never "
            "leave the vault for a milestone until its audit passes (or you intervene manually in demo/admin flows).",
            styles["body"],
        )
    )

    story.append(PageBreak())

    # --- 3. Tech stack ---
    story.append(Paragraph("3. Tech stack", styles["h1"]))
    stack_rows = [
        ("Runtime & API", "Node.js 18+, Express — REST API and static demo UI on the same origin"),
        ("Data", "Prisma ORM + PostgreSQL (e.g. Neon on Render)"),
        ("Payments", "PayPal REST — Orders API (fund / capture) and Payouts API (release)"),
        ("Source control", "GitHub — repo link per milestone, HMAC-verified pull_request webhooks"),
        ("Verification", "AI auditor — LLM when API keys are set; deterministic heuristics otherwise"),
        ("Identity", "DigiLocker / Stripe Identity scaffolds; consent logging with KYC gates"),
        ("Hosting", "Docker image; Render Blueprint (preferred), Railway, or Fly.io — live at aegis-split.onrender.com"),
    ]
    t = Table(
        [[Paragraph(f"<b>{a}</b>", styles["body"]), Paragraph(b, styles["body"])] for a, b in stack_rows],
        colWidths=[1.45 * inch, content_w - 1.45 * inch],
    )
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 12))

    # --- 4. Architecture ---
    story.append(Paragraph("4. Architecture", styles["h1"]))
    story.append(
        Paragraph(
            "Browser clients talk to the Aegis-Split app. The app orchestrates PayPal escrow, listens "
            "for GitHub merge events, invokes the auditor, and persists state in PostgreSQL.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(architecture_flowable(content_w))
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Key API areas: <font name='Courier'>/api/vault/*</font> (fund/capture), "
            "<font name='Courier'>/api/webhooks/github</font> (merge), "
            "<font name='Courier'>/api/projects/*/milestones/*</font> (milestones, link, release), "
            "<font name='Courier'>/api/notifications</font> (FUNDED, AUDIT_*, PAID).",
            styles["body"],
        )
    )

    story.append(Spacer(1, 8))
    story.append(Paragraph("Trust &amp; safety (before money moves)", styles["h1"]))
    story.append(
        Paragraph(
            "Before creating projects, funding a vault, or linking production merges, each user must "
            "complete government-ID verification (DigiLocker for India, Stripe Identity scaffold "
            "elsewhere) and grant monitoring consent with a timestamped audit log. Middleware on "
            "protected routes returns <font name='Courier'>403</font> until both flags are set — "
            "reducing anonymous dispute risk without replacing PayPal as the payment rail.",
            styles["body"],
        )
    )
    story.append(
        Paragraph(
            "<b>Notifications:</b> Idempotent in-app alerts fire for FUNDED, AUDIT_PASSED / AUDIT_FAILED, "
            "and PAID events so both client and freelancer see the same timeline.",
            styles["body"],
        )
    )

    story.append(PageBreak())

    # --- 5. Live demo ---
    story.append(Paragraph("5. Live demo", styles["h1"]))
    story.append(
        Paragraph(
            'Production sandbox deployment: <b><a href="https://aegis-split.onrender.com" color="#2563eb">'
            "https://aegis-split.onrender.com</a></b>",
            styles["body"],
        )
    )
    story.append(
        Paragraph(
            "The hosted app serves the demo UI at <font name='Courier'>/</font> and the Express API "
            "under <font name='Courier'>/api/*</font>. Use PayPal sandbox accounts and the demo seed "
            "flow to walk through fund → merge → audit → paid without installing locally.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 8))

    # --- 6. How to test ---
    story.append(Paragraph("6. How to test", styles["h1"]))
    story.append(Paragraph("<b>Live (Render)</b>", styles["body"]))
    live_bullets = [
        "Open https://aegis-split.onrender.com",
        "Click <b>Seed Sarah &amp; Rohan</b> (uses demo admin key configured on the host)",
        "Switch user → complete gov ID verify + monitoring consent (sandbox/demo mode as deployed)",
        "Create a project and milestone → <b>Fund vault</b> → approve in PayPal sandbox (or mock if enabled)",
        "Link GitHub repo → <b>Simulate merge</b> (or trigger a real webhook if the app URL is public)",
        "Confirm AI audit PASS, milestone PAID, and in-app notifications",
    ]
    for b in live_bullets:
        story.append(Paragraph(f"• {b}", styles["bullet"]))

    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Local</b>", styles["body"]))
    story.append(
        Paragraph(
            "<font name='Courier'>cp .env.example .env && npm install && npx prisma migrate deploy && npm start</font>",
            styles["mono"],
        )
    )
    story.append(
        Paragraph(
            "Open <font name='Courier'>http://localhost:3000</font>. Auth is stubbed: the demo UI sets "
            "<font name='Courier'>X-User-Id</font> when you pick a user.",
            styles["body"],
        )
    )
    env_rows = [
        ("DATABASE_URL", "PostgreSQL connection string"),
        ("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET", "Sandbox credentials (or PAYPAL_MOCK=true)"),
        ("PAYPAL_MODE", "sandbox"),
        ("GITHUB_WEBHOOK_SECRET / GITHUB_TOKEN", "For real webhooks and PR diffs; optional for simulate-merge"),
        ("DEMO_ADMIN_KEY", "Defaults to hackathon-demo-key for seed and simulate-merge"),
        ("OPENAI_API_KEY or ANTHROPIC_API_KEY", "Optional — enables LLM auditor; otherwise deterministic"),
    ]
    t2 = Table(
        [[Paragraph(f"<font name='Courier'>{k}</font>", styles["body"]), Paragraph(v, styles["body"])] for k, v in env_rows],
        colWidths=[2.35 * inch, content_w - 2.35 * inch],
    )
    t2.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
            ]
        )
    )
    story.append(Spacer(1, 6))
    story.append(Paragraph("Environment variables (high level — see <font name='Courier'>.env.example</font>):", styles["body"]))
    story.append(t2)
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "Run <font name='Courier'>npm test</font> for KYC, PayPal, GitHub, auditor, and notification unit checks. "
            "For full payout testing without PayPal credentials, set <font name='Courier'>PAYPAL_MOCK=true</font>.",
            styles["body"],
        )
    )

    story.append(Spacer(1, 10))
    story.append(Paragraph("API walkthrough (local or curl)", styles["h1"]))
    story.append(
        Paragraph(
            "After seeding users, pick a user in the UI (sets <font name='Courier'>X-User-Id</font>) or pass the header manually:",
            styles["body"],
        )
    )
    curl_blocks = [
        "POST /api/vault/fund  { projectId, milestoneId, amountCents }",
        "GET  /api/vault/paypal/return?token=ORDER_ID   (after PayPal approve)",
        "POST /api/projects/:projectId/milestones/:id/github  { githubRepoFullName, githubPrNumber }",
        "POST /api/admin/demo/milestones/:id/simulate-merge  (+ X-Demo-Admin-Key)",
        "POST /api/projects/:projectId/milestones/:id/release  { recipientEmail }",
    ]
    for line in curl_blocks:
        story.append(Paragraph(f"<font name='Courier'>{line}</font>", styles["mono"]))

    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "<b>Real GitHub webhook:</b> Expose your app URL (Render fulfills this), set "
            "<font name='Courier'>GITHUB_WEBHOOK_SECRET</font> on the repo webhook, and merge a linked PR. "
            "The handler verifies HMAC, pulls the diff with <font name='Courier'>GITHUB_TOKEN</font>, "
            "runs the auditor, and on PASS calls the same release path as simulate-merge.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            "<b>PayPal sandbox notes:</b> Default flow creates an order and returns an "
            "<font name='Courier'>approvalUrl</font> for the sandbox buyer. Capture runs on "
            "<font name='Courier'>/api/vault/paypal/return</font> when the order is APPROVED. "
            "Set the freelancer user’s <font name='Courier'>paypal_email</font> to a sandbox personal "
            "account for payout testing.",
            styles["body"],
        )
    )

    return story


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()

    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=0.85 * inch,
        rightMargin=0.85 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.85 * inch,
    )

    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="normal",
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="First", frames=frame, onPage=_header_band),
            PageTemplate(id="Later", frames=frame, onPage=_header_band),
        ]
    )

    story = build_story(styles)
    # Switch to Later template after first page content starts — we use PageBreak for inner pages
    doc.build(story, canvasmaker=NumberedCanvas)

    # Report page count
    from pypdf import PdfReader

    try:
        pages = len(PdfReader(str(OUTPUT)).pages)
    except ImportError:
        # fallback: PyPDF2 or manual
        try:
            from PyPDF2 import PdfReader as PR

            pages = len(PR(str(OUTPUT)).pages)
        except ImportError:
            pages = -1

    print(f"Wrote {OUTPUT} ({pages} pages)" if pages > 0 else f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
