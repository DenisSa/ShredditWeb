# Yard UI Redesign Proposal

## Goal

Reduce visual noise, make the destructive workflow feel safer, and help users understand where they are in the process at a glance.

The current UI works, but it asks the user to parse too many equally prominent surfaces at once: a large hero, multiple stat grids, several alert styles, dense cards, and a separate report region all compete for attention.

## Core Problems In The Current UI

1. Too many cards have the same visual weight.
   The hero, auth, preview, execution, sample items, progress, and report all use similarly strong rounded containers.

2. Too many numbers appear before the user needs them.
   Counts are useful after preview starts, but four preview stats and three run stats appear as peers with the primary actions.

3. Status is fragmented.
   Session state, preview state, run state, warnings, and notices are spread across different blocks instead of forming one clear journey.

4. Safety messaging is visually noisy.
   Warnings are important, but the current design repeats cautionary language in several separate surfaces.

5. The page feels more like a dashboard than a guided workflow.
   This product is really a three-step task: connect, review, run.

## Proposed Direction

Design the app as a calm operations console with a guided step flow.

### Visual Tone

- Cleaner and quieter than the current warm gradient-heavy treatment
- Light, slightly cool neutral canvas with one strong action color and one danger color
- More whitespace, fewer borders, less blur, less layered tinting
- Stronger typography hierarchy and fewer all-caps labels

### Brand Feel

Shreddit should feel deliberate and trustworthy, not flashy. Think "privacy tool" or "deployment console" rather than "marketing landing page."

## New Information Architecture

### Top Bar

A very slim header:

- Logo and product name
- Session state badge
- Secondary link to docs/help if needed

Remove the template-style social/search/sponsor navigation entirely.

### Main Layout

Use a two-column layout on desktop and a single column on mobile.

Left column:

1. Stepper
2. Active step panel
3. Supporting detail for the selected step

Right column:

1. Sticky "Run summary" rail
2. Current rules
3. Session status
4. Job progress
5. Latest result/report summary

This keeps the main task in one place while preserving context without forcing everything into the primary reading path.

## Recommended Screen Structure

### 1. Connect

Do not use an intro panel or marketing-style hero.

The page should open directly into the workflow with a stepper at the top of the main column:

1. Connect account
2. Review matches
3. Run cleanup

Directly below the stepper, show the current step panel.

For the connect state, keep the content minimal:

- Session status
- Configuration status if something is missing
- Primary CTA: "Connect Reddit"
- Secondary CTA: "Clear session" only when relevant

The stepper should always show state:

- Not started
- Ready
- In progress
- Complete
- Needs attention

### 2. Review Matches

After authentication, the preview step becomes the main panel.

Replace the current four equal stat cards with:

- One headline number: "142 items eligible"
- One supporting line: "From 921 comments and 84 posts scanned"
- Compact rule chips: "Older than 7 days", "Score below 100"

Under that, show segmented tabs or filters:

- All eligible
- Comments
- Posts
- Excluded reasons

For preview items, use a simple list row pattern instead of stacked cards:

- Type icon
- Subreddit
- Age
- Score
- Snippet
- External link icon

This will dramatically reduce visual density.

### 3. Run Cleanup

Make this step feel intentional and safe.

Suggested structure:

- Mode selector:
  - Dry run
  - Live deletion
- Confirmation box with concise, plain language
- Primary action button

Move the run progress into the right rail and keep it sticky during execution:

- Current phase
- Progress bar
- Processed / deleted / failed in one compact row
- Live activity label

This prevents the main layout from jumping as the run updates.

### 4. Report

Do not render the full report area by default at page bottom.

Instead:

- Show a compact completion card in the right rail
- Add a "View report details" expander or drawer
- Keep the download action there

Failures should be progressively disclosed:

- Show a failure count first
- Expand to list only when needed

## Visual System Recommendations

### Spacing

- Use larger section spacing and smaller internal card spacing
- Avoid stacking many bordered surfaces directly on top of each other
- Prefer one container per section, not container-inside-container-inside-container

### Typography

- Use one strong display style for the page title
- Use sentence case for most labels
- Reserve uppercase only for tiny metadata or badges
- Reduce the number of font sizes in active use

Suggested hierarchy:

- Page title
- Section title
- Metric / status value
- Body copy
- Caption / metadata

### Color

Suggested palette direction:

- Background: soft stone or mist
- Surface: white or near-white
- Ink: charcoal
- Accent: muted red-orange
- Danger: deep brick
- Success: muted green

Use the accent color mainly for:

- Primary CTA
- Active step
- Important links
- Progress highlights

### Motion

Keep motion subtle and meaningful:

- Step transition fade/slide
- Progress updates
- Expand/collapse for preview details and report details

Avoid decorative motion in the page shell.

## Component Changes

### Keep

- Progress bar
- Preview list
- Download report
- Session warnings

### Simplify

- Stat cards -> headline metric plus compact inline stats
- Multiple notices -> single status area per step
- Failure cards -> expandable table/list

### Remove

- Template navbar and template site config content
- Unused social/search/sponsor affordances
- Heavy glassmorphism look
- Repeated explanatory paragraphs in each section

## Mobile Behavior

On mobile, the experience should become a stacked task flow:

1. Stepper
2. Current step panel
3. Sticky bottom action area
4. Collapsible summary sections

Avoid four-across or two-across metric grids on small screens. Use compact list items instead.

## Accessibility And Safety

- Keep destructive actions visually distinct from neutral actions
- Preserve explicit confirmation for live deletion
- Announce progress state changes accessibly
- Ensure status color is not the only signal
- Keep line lengths shorter in warning and help text

## Implementation Plan

### Phase 1: Structural cleanup

- Remove unused template navigation and config content
- Replace the hero with an immediate stepper + current-step layout
- Create a persistent right-side summary rail
- Consolidate notices into one status area per step

### Phase 2: Preview redesign

- Replace preview stat cards with a hero metric and compact secondary stats
- Convert preview samples into dense list rows
- Add content-type filters

### Phase 3: Execution and report

- Move run progress into sticky summary rail
- Redesign confirmation block and mode selector
- Collapse report details behind an expander or drawer

### Phase 4: Visual polish

- Refresh spacing, color tokens, and typography
- Add subtle transitions
- Tune mobile layouts

## Suggested Success Criteria

- A new user can understand the three-step flow within five seconds
- The primary action is always obvious
- The destructive state feels deliberate, not buried
- Preview results are scannable without card fatigue
- The page remains stable during long-running jobs

## Notes For Implementation

The redesign can happen without changing the underlying server flow or API shape. Most of the value is in reorganizing the existing data and reducing competing UI emphasis.
