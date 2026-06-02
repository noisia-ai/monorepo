import { z } from "zod";

const countryCodeSchema = z.string().length(2).transform((value) => value.toUpperCase());
const optionalText = (max: number, min = 0) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    min > 0 ? z.string().min(min).max(max).optional() : z.string().max(max).optional()
  );
const shortListItem = (max: number, min = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : value),
    z.string().min(min).max(max)
  );

export const createBrandSchema = z.object({
  organization_id: z.string().uuid().optional(),
  organization_name: optionalText(180, 2),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(160),
  display_name: optionalText(160),
  industry: optionalText(80, 2),
  industry_sub: optionalText(80, 2),
  countries: z.array(countryCodeSchema).min(1).default(["MX"]),
  description: optionalText(12000),
  brand_seed_handles: z.array(shortListItem(240)).default([]),
  competitors: z.array(shortListItem(240, 2)).default([]),
  knowledge_notes: optionalText(50000),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  primary_brand_manager_user_id: z.string().uuid().optional()
}).refine((data) => data.organization_id || data.organization_name, {
  path: ["organization_name"],
  message: "Selecciona una organización o crea una nueva."
});

export const updateBrandSchema = z.object({
  organization_id: z.string().uuid(),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(160),
  display_name: optionalText(160),
  industry: optionalText(80, 2),
  industry_sub: optionalText(80, 2),
  countries: z.array(countryCodeSchema).min(1).default(["MX"]),
  description: optionalText(12000),
  brand_seed_handles: z.array(shortListItem(240)).default([]),
  status: z.enum(["active", "paused", "archived"]).default("active")
});

export const createThemeSchema = z.object({
  organization_id: z.string().uuid().optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(180),
  description: z.string().max(3000).optional(),
  industry_focus: z.array(z.string().min(2).max(80)).default([]),
  geo_focus: z.array(countryCodeSchema).min(1).default(["MX"]),
  status: z.enum(["draft", "active", "published", "archived"]).default("draft"),
  is_public: z.boolean().default(false)
});

export const createStudySchema = z.object({
  name: z.string().min(3).max(180),
  brand_id: z.string().uuid(),
  methodology_id: z.string().uuid(),
  business_question: z.string().min(10).max(800),
  decision_to_inform: optionalText(800),
  audience_segment: optionalText(400),
  category_context: optionalText(1200),
  hypotheses: optionalText(1200),
  competitive_context: optionalText(2400),
  known_barriers: optionalText(1200),
  known_triggers: optionalText(1200),
  strategic_constraints: optionalText(1200),
  success_criteria: optionalText(1200),
  geo_focus: z.array(countryCodeSchema).min(1).max(6).default(["MX"]),
  target_window_months: z.coerce.number().int().min(1).max(36).default(12)
});
