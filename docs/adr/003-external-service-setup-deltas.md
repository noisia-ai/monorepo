# ADR-003: Deltas de setup externo contra spec v2

## Status
Accepted (2026-05-23)

## Context
Durante el setup se usaron versiones y configuraciones vigentes de servicios externos que difieren ligeramente de los ejemplos del paquete.

## Decision
- Supabase remoto corre Postgres 17.6, aunque el spec pide Postgres 15+.
- Anthropic usara `claude-sonnet-4-6` como modelo default porque la API key lo valido correctamente.
- Resend usara `Noisia Studio <team@hey.noisia.ai>` como remitente inicial.
- WhatsApp se mantiene postpuesto; email cubre notificaciones MVP.

## Rationale
- Postgres 17.6 cumple el requisito 15+.
- El modelo Anthropic disponible debe reflejar la configuracion real de 2026-05-23.
- `hey.noisia.ai` ya fue configurado y verificado para email.

## Consequences
+ Menos drift entre ambiente real y codigo.
+ El `.env.example` refleja servicios actuales.
- Cualquier cambio de modelo debe revisarse con tests de calidad de IA.

// TODO mejora-futura: centralizar modelos LLM y proveedores en una tabla/config administrable, con fallback OpenAI activo solo cuando exista presupuesto o contrato que lo requiera.
