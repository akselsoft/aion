
1. Get artifact engine supporting JSON properly
Ensure that collector either does the convert and simply moves files to artifacts or does both - has to one or the other
Update RFP-grid to actively have it take the grid and populate the values, identifying rather than simply provide a basic summary
The problem right now is that there are too many tokens in the work history so I need to create a version that reduces it. But maybe that’s not even possible

Objective
Create a reusable “Editor” persona that ships with hard-coded prompt contract + scoring rubric, so users can run structural reviews without building custom engines or embedding long prompts in config.

Persona Name
Editor (or StructuralEditor if you expect multiple editor types later)

Persona Contract (hard-coded)
 • Reviews structure only (Trigger/Decision/Cost/Irreversibility/State Change)
 • Classifies issues: Missing / Vague / Inverted / Competing / Unclassifiable
 • Scores issues (0–5) with severity floors (invalid Trigger ≥ 4, etc.)
 • Returns:
 • Issues Found (count)
 • Per-issue score + classification + short note
 • Overall score = max issue score
 • Always outputs a score even when clean

Inputs (minimal)
 • Text for one section OR list of sections with identifiers
 • Optional options:
 • strictness (default strict)
 • return_clean_score (default 1)
 • stop_on_5 (default true)

Outputs (standardized JSON + human text)
 • JSON for downstream tooling (sorting, dashboards)
 • Human-readable summary for logs

What it deliberately does NOT do
 • No fixes
 • No rewrites
 • No suggestions
 • No theme interpretation
 • No technical mechanism proposals

⸻

Acceptance criteria

 1. If Trigger contains background/setup/context → Score ≥ 4 with Trigger: Invalid.
 2. If Decision or Irreversibility missing → Score 5 and stop after listing issues.
 3. If no issues → returns Score: 1 – Clean, Issues Found: 0.
 4. Produces identical results when run via persona vs. via embedded config prompt (parity test).
