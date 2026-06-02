import { z } from "zod";

const roleSchema = z.enum(["noisia_admin", "analyst", "client_admin", "client_viewer"]);

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(200);

// Invitar a alguien al workspace. Los roles internos (noisia_admin/analyst) no
// llevan organización; los roles de cliente requieren una.
export const createInvitationSchema = z
  .object({
    email: emailSchema,
    primary_role: roleSchema,
    organization_id: z.string().uuid().optional()
  })
  .refine(
    (data) =>
      data.primary_role === "noisia_admin" || data.primary_role === "analyst"
        ? true
        : Boolean(data.organization_id),
    {
      path: ["organization_id"],
      message: "Los roles de cliente requieren una organización."
    }
  );

// Cambiar rol / organización / estado de un usuario existente.
export const updateUserSchema = z
  .object({
    primary_role: roleSchema.optional(),
    organization_id: z.string().uuid().nullable().optional(),
    status: z.enum(["active", "suspended"]).optional()
  })
  .refine((data) => data.primary_role || data.organization_id !== undefined || data.status, {
    message: "Nada que actualizar."
  });

export const createOrganizationSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  legal_name: z.string().trim().min(2).max(180),
  display_name: z.string().trim().max(180).optional(),
  hq_country: z.string().length(2).transform((value) => value.toUpperCase()).default("MX"),
  industry_primary: z.string().trim().max(80).optional(),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  notes: z.string().trim().max(3000).optional()
});

export const updateOrganizationSchema = createOrganizationSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "Nada que actualizar." }
);

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
