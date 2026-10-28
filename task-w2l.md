# W2L Feature — Implementation Plan

## 1. client-forms.ts
- Add `W2L_STATUS` const: "Em Processamento", "Em Assinatura", "Pendente", "Consentida"
- Add W2L fields to LUZ/GÁS/DUAL forms: `leedNumber` (text), `leedCreatedAt` (date), `leedStatus` (select)
- The `w2l` boolean is not a form field (like `amigo`) — added via API allowed set

## 2. sales.ts (API route)
- Add `"w2l"`, `"leedNumber"`, `"leedCreatedAt"`, `"leedStatus"` to allowed set

## 3. sale-form.tsx
- Add `W2lCheckbox` component (modeled after `AmigoCheckbox`)
- Show W2L fields only when w2l is checked
- When leedNumber is typed, look up existing sales with w2l=true and same leedNumber to auto-fill

## 4. New page: pages/w2l.tsx
- Lists all sales with w2l=true (similar to vtv-status.tsx structure)
- "+" button to create a new sale with w2l pre-checked
- Fields: Escola (Luz/Gás/Dual), Nome, NIF, Contacto, Data para a Chamada, Gestor de Cliente

## 5. app-shell.tsx + app.tsx
- Add nav item: W2L with icon
- Add route: /w2l

STARTING NOW