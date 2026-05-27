# ADR-002: Auth, signup y frontera Supabase/Kinde

## Status
Accepted (2026-05-23)

## Context
El setup de Supabase menciona "Auth basica", pero las decisiones tecnicas firmadas establecen Kinde como proveedor de autenticacion. Durante setup se aclaro que clientes si necesitan signup/login para entrar al portal, pero no self-service onboarding de estudios.

## Decision
Kinde es el unico proveedor de autenticacion de producto. Supabase se usa para Postgres, Storage, RLS y SMTP auxiliar si aplica, no para login de Noisia Studio.

El signup de usuarios cliente esta permitido, pero el acceso a organizaciones, marcas, dashboards y estudios requiere asignacion por Noisia o invitacion controlada.

## Rationale
- Kinde soporta organizaciones y roles para multi-cliente.
- El portal cliente necesita login/signup real.
- Noisia conserva control operativo sobre estudios, permisos y publicacion.

## Consequences
+ Clientes pueden crear o aceptar cuenta para entrar al portal.
+ Usuarios sin permisos quedan sin acceso a data hasta asignacion interna.
- Hay que disenar una pantalla de "cuenta pendiente de aprobacion".
- Hay que mapear roles Kinde a `users.primary_role` y permisos internos.

// TODO mejora-futura: evaluar dominios permitidos e invitaciones obligatorias cuando entren agencias externas con multiples clientes.
