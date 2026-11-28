---
name: Nile Therapy Portal
description: The internal portal where Nile Therapy's founders and home-visit physiotherapists run patients, visits and sessions.
colors:
  brand: "#0f7d74"
  brand-hover: "#0b6a62"
  brand-ink: "#0b4f5c"
  river: "#12917f"
  water: "#9fdccf"
  water-soft: "#e3f6f1"
  coral: "#e0583f"
  coral-ink: "#a63a26"
  coral-soft: "#fdece8"
  leaf: "#5fa84a"
  leaf-ink: "#2f6b2a"
  leaf-soft: "#e8f4e2"
  roof: "#487878"
  bg: "#f3f8f7"
  surface: "#ffffff"
  surface-2: "#eef5f3"
  ink: "#14303a"
  muted: "#557078"
  line: "#dae8e4"
  line-soft: "#e9f2ef"
  danger: "#b3372a"
  whatsapp: "#15803d"
typography:
  headline:
    fontFamily: "Outfit, Readex Pro, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Outfit, Readex Pro, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  subtitle:
    fontFamily: "Outfit, Readex Pro, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Outfit, Readex Pro, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-ar:
    fontFamily: "Readex Pro, Outfit, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Outfit, Readex Pro, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  sm: "10px"
  md: "14px"
  dialog: "18px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "22px"
  page: "32px 40px"
  page-phone: "18px 14px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "22px"
  pill:
    backgroundColor: "{colors.leaf-soft}"
    textColor: "{colors.leaf-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
    typography: "{typography.label}"
  nav-item-active:
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: Nile Therapy Portal

## Overview

**Creative North Star: "The Calm River Clinic"**

The portal should feel like a tidy, well-lit clinic: white work surfaces on a pale water-green ground, deep river teal for the things you act on, and the Nile running through it as soft teal gradients and the lotus watermark. It is a working tool used between home visits, so calm and legible come first; the river is the brand thread, not decoration on top of the work.

Colour is used richly but with meaning. Teal carries action and data, coral carries the human warmth of home visits and anything that needs attention, leaf green says "done", and the slate roof tone separates the fourth kind of thing. Future screens should use this full palette to tell categories apart at a glance instead of leaning on teal alone, while keeping red strictly for problems.

Arabic and English are equals: every layout mirrors cleanly right-to-left, Arabic is set in Readex Pro and English in Outfit.

**Key Characteristics:**
- White cards (14px corners, soft two-layer shadow) on a pale water-green page.
- Pill-shaped buttons and badges; deep teal gradient for primary actions.
- Dark river-teal side menu with the lotus watermark.
- Colour-coded categories (session type, visit status, calendar kinds) using the full brand palette.
- Drawn stroke icons (1em, follow text colour); no emoji as icons.

## Colors

A river palette: deep teals and water greens, warmed by coral and grounded with leaf green.

### Primary
- **Nile Teal** (brand): primary buttons, links, numbers, active states.
- **Deep River** (brand-ink): headings, the side menu, the darkest text on tinted badges.
- **Running Water** (river) and **Shallow Water** (water / water-soft): gradients, chart bars, tinted backgrounds, focus on the dark menu.

### Secondary
- **Lotus Coral** (coral / coral-ink / coral-soft): home visits, warm highlights, and "needs attention" accents.

### Tertiary
- **Leaf Green** (leaf / leaf-ink / leaf-soft): done, logged, success; clinic sessions.
- **Old Roof Slate** (roof): the fourth category colour in charts and stats.

### Neutral
- **River Ink** (ink): body text. **Silt** (muted): secondary text, at least 4.5:1 on white.
- **Clinic White** (surface), **Mist** (bg), **Foam** (surface-2): page and panels.
- **Reed Line** (line / line-soft): borders and dividers.
- **Warning Red** (danger): errors, destructive actions, overdue alerts only.
- **WhatsApp Green** (whatsapp): WhatsApp buttons only, darkened so white text passes 4.5:1.

### Named Rules
**The Red Means Trouble Rule.** Danger red appears only for a real problem (an error, a delete, a patient nobody took). Never as decoration.

**The Colour Has a Job Rule.** Every colour on a screen names a category or a state. Use the full palette to tell kinds apart, and keep the same colour for the same kind everywhere (home visit coral, clinic green, online teal).

**The Readable Badge Rule.** Text on a tinted badge uses the palette's ink shade (brand-ink, coral-ink, leaf-ink), never the mid tone.

## Typography

**Display Font:** Outfit (English), Readex Pro (Arabic)
**Body Font:** Outfit / Readex Pro, with system-ui fallback

**Character:** Rounded, friendly geometric sans in both scripts, so English and Arabic sit at the same weight and warmth.

### Hierarchy
- **Headline** (700, 26px): page titles, one per page.
- **Title** (700, 20px): card and section titles.
- **Subtitle** (600, 15px): names in cards, list item titles.
- **Body** (400, 15px, 1.5): everything else. Phone form fields stay at 16px so iPhones don't zoom.
- **Label** (600, 12px): badges, table headers (uppercase with +0.04em tracking in English only; Arabic never uppercased or tracked).

### Named Rules
**The 12px Floor Rule.** Nothing a user needs to read is smaller than 12px (11px only for a two-letter initials tag).

## Layout

Fixed dark side menu (desktop) beside a fluid main column with 32px × 40px page padding; on screens under 980px the menu becomes a top bar with a menu button, and doctors get a bottom tab bar. Breakpoints in use: 1100, 980, 700, 640, 600, 480px.

Pages follow one order: alerts, then a head row (title + one-line purpose on one side, actions on the other), then content. Grids are `auto-fill` with a minimum column width (doctor cards 280px) and two-column card grids that collapse to one under 980px. Cards in a row align to their top; they do not stretch to the tallest neighbour. A new page opens scrolled to the top.

## Elevation & Depth

Mostly flat with one soft ambient shadow. Cards use a two-layer teal-tinted shadow (`0 1px 2px` + `0 6px 18px` at 5% river ink); dialogs float higher (`0 30px 80px` at 25%). Depth otherwise comes from tinted backgrounds and borders, not shadows.

## Shapes

Generous, friendly rounding: 10px for inputs and menu items, 14px for cards, 18px for dialogs, full pills for buttons, badges and chips. Borders are 1px reed lines. Status is shown with a full border colour, a tint and a label, never a stripe down one side.

## Components

### Buttons
- **Shape:** full pill (999px).
- **Primary:** Nile Teal gradient, white 600 text, 10px × 20px.
- **Hover / Focus:** darker gradient; 2px teal focus ring offset 2px (water-green ring on the dark menu).
- **Ghost / Danger:** white with reed or soft-red border, teal or red text.

### Chips and badges
- **Style:** tinted pill, ink-shade text, 12px 600.
- **Kinds:** home visit coral, clinic leaf, online water, off grey, website water.

### Cards / Containers
- **Corner Style:** 14px. **Background:** white. **Shadow:** ambient. **Border:** 1px reed. **Padding:** 22px (16–18px for stat cards).

### Inputs / Fields
- **Style:** 1px reed border, 10px corners, white.
- **Focus:** border turns Nile Teal with a soft 3px teal halo.
- Every field is linked to its label (the portal links them automatically).

### Navigation
- Dark river-teal gradient menu with the lotus watermark; items 10px × 12px, 10px corners. Active item: water-green tint and 600 weight. Groups collapse; badges show counts in coral/red.

### Schedule visit chip (signature)
- White card with a full teal-tinted border; done visits turn leaf with a green border; cancelled visits dashed and faded; time in bold teal on top.

## Do's and Don'ts

### Do:
- **Do** use drawn stroke icons from the portal's `icon()` set (1em, current colour).
- **Do** give every category its own palette colour and reuse it everywhere.
- **Do** keep badge text in the ink shades so it passes 4.5:1.
- **Do** check every screen in Arabic (right-to-left) and English, at 375px and on a laptop.

### Don't:
- **Don't** use emoji as icons.
- **Don't** put a coloured stripe down one side of a card or chip.
- **Don't** use red for anything but a real problem.
- **Don't** go below 12px for readable text.
