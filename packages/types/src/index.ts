export type NoisiaSubjectType = "brand" | "theme";

export type NoisiaUserType = "noisia_internal" | "client" | "agency";

export type NoisiaCanonicalRole =
  | "noisia_admin"
  | "analyst"
  | "client_admin"
  | "client_viewer";

export type NoisiaPrimaryRole =
  | NoisiaCanonicalRole
  | "founder"
  | "admin"
  | "kam"
  | "insights_manager"
  | "ux_data_specialist"
  | "client_owner"
  | "brand_manager"
  | "agency_insights";
