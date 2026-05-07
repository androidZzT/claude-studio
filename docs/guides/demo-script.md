# harness-studio Demo Video Script

Target: 60s, MP4, 1920x1080, Kap recording

## Pre-recording Setup

- Browser: Chrome, clean tab, no bookmarks bar
- URL: localhost:3000
- Project: ~/Claude/code-dojo (has agents, skills, workflows)
- Theme: Dark mode (visually stronger for demo)
- Font size: browser zoom 110% for readability
- Close all other apps, hide dock

---

## Scene 1: Launch (0-5s)

**Action**: Terminal already open, type and hit enter
```
npx harness-studio
```
**Cut to**: Browser auto-opens, welcome page loads

**Key message**: Zero config, one command

---

## Scene 2: Open Project (5-12s)

**Action**: Click "Open Project" > select code-dojo directory
**Show**: Left panel populates — Agents (5), Skills (3), Workflows (1)

**Key message**: Reads your existing .claude/ directory

---

## Scene 3: Browse Agents & Skills (12-20s)

**Action**: 
- Click through agents list (Critic, Scribe, Sensei, Solver-A, Solver-B)
- Click one agent — right panel shows markdown editor with frontmatter
- Quick click on a skill — show skill definition

**Key message**: Full CRUD for agents and skills, visual editing

---

## Scene 4: AI Generate Workflow (20-42s) -- HERO MOMENT

**Action**:
1. Click "New" in Workflows section > "Blank"
2. Empty canvas with just `user` and `team-lead` nodes
3. Move cursor to the description input in toolbar
4. Type: `Code review pipeline with security audit and TDD`
5. Click **Generate** button
6. **PAUSE** — wait for Claude to generate (loading animation)
7. **BAM** — full DAG appears: user → team-lead → tester + security-reviewer + developer → code-reviewer → approval checkpoint

**Camera**: Stay on canvas, let the DAG populate visually

**Key message**: Describe in plain text, get a complete multi-agent workflow

---

## Scene 5: Visual Editing (42-50s)

**Action**:
- Drag a node to reposition
- Click a node — right panel shows Node Editor (agent, task, skills, checkpoint toggle)
- Drag a skill badge onto a node to bind it

**Key message**: Fine-tune the generated workflow visually

---

## Scene 6: Save & Sync (50-58s)

**Action**:
1. Click **Save** in toolbar
2. Open CLAUDE.md tab (or show it in right panel editor)
3. Scroll to show the workflow definition auto-synced into CLAUDE.md

**Key message**: Design here, Claude Code reads it at runtime

---

## Scene 7: End Card (58-60s)

**Action**: Cut to centered text overlay (add in post)

```
harness-studio
npx harness-studio

github.com/androidZzT/harness-studio
```

---

## Recording Tips

- Mouse movements: slow and deliberate, no jitter
- No clicking sounds (mute mic)
- If typing, use natural speed (not instant paste)
- Pause 1s after each major action for viewer to absorb
- If AI Generate takes >10s, speed up the waiting part 2x in post

## Post-production

1. Trim dead air
2. Speed up loading/waiting sections (2x)
3. Compress: `ffmpeg -i raw.mp4 -vcodec libx264 -crf 28 -preset slow demo.mp4`
4. Target: <10MB for GitHub README embed
5. Upload to GitHub Issue to get URL, embed in README with:
   ```html
   <div align="center">
     <video src="https://github.com/user-attachments/assets/xxx" width="720" />
   </div>
   ```
