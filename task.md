# D2D Terreno — Integração

## Phase 1: Core (em curso)
- [ ] Copy D2D HTML to public/
- [ ] Create DB schema (d2d_shifts, d2d_doors, d2d_events, d2d_daily_reports)
- [ ] Create API routes (Hono): POST /api/d2d, GET /api/d2d/me, GET /api/d2d/equipa
- [ ] Create React page component (d2d.tsx) with iframe + postMessage
- [ ] Add route in app.tsx
- [ ] Add nav item in app-shell.tsx
- [ ] Verify lint + build

## Phase 2: Documents
- [ ] d2d_documents table, d2d_caixa table
- [ ] POST /api/d2d/documentos (multipart)
- [ ] GET /api/d2d/caixa
- [ ] Handle document events (documento_apagado, documentos_enviados, documentos_lidos)

## Phase 3: Auto-close & Push
- [ ] Schedule for 23:59 auto-close
- [ ] Push notification infrastructure

## Phase 4: Sales integration
- [ ] When "venda" result → create client + sale