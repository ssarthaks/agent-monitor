# Agent Monitor — Landing Page

A modern, responsive, high-performance landing page showcasing **Agent Monitor**.

## Features Included

- **Hero & Value Proposition**: Clear developer positioning (*"Treat AI Agent Actions as Untrusted Syscalls"*).
- **Interactive Live Policy Simulator**: Lets visitors test commands (`rm -rf /`, `git push origin main`, `file.write ../../etc/passwd`, `npm i axios`) and observe real-time decisioning, risk scoring (0-100), and policy AST specificity.
- **Architectural Comparison**: Side-by-side comparison illustrating why prompt-layer safety fails and why runtime control boundaries are required.
- **14-Stage Universal Boundary Breakdown**: Complete interactive grid detailing every stage in the fail-closed pipeline.
- **Bento Feature Grid**: Highlights MCP transparent proxying, SQLite WAL kill switch, secret redaction, auto-Git exclusion, and SHA-256 audit ledger.
- **Drop-in Quickstart**: Tabbed code switcher for CLI, Claude Desktop, Cursor IDE, and TypeScript SDK with one-click copy buttons.
- **Zero Build Requirement**: Pure HTML5, modern Tailwind CSS via CDN, and Lucide icons. Runs instantly in any browser.

---

## How to View Locally

### On macOS
```bash
open landing/index.html
```

### Via lightweight static server
```bash
npx serve landing
```

---

## Deployment

Because `landing/index.html` is completely self-contained and static:
- **GitHub Pages**: Set source branch to `main` with `/landing` folder.
- **Vercel / Cloudflare Pages / Netlify**: Point root directory to `landing/`.
