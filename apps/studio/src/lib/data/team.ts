import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, sql } from "drizzle-orm";

import { brands, invitations, organizations, studyCorpora, themes, users } from "@noisia/db";
import { db } from "@/lib/db";

export type TeamMember = {
  id: string;
  email: string;
  fullName: string | null;
  primaryRole: string;
  userType: string;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type PendingInvitation = {
  id: string;
  email: string;
  primaryRole: string;
  organizationId: string | null;
  organizationName: string | null;
  invitedByName: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export type OrganizationAdminRow = {
  id: string;
  slug: string;
  legalName: string;
  displayName: string | null;
  hqCountry: string | null;
  industryPrimary: string | null;
  status: string;
  usersCount: number;
  pendingInvitationsCount: number;
  brandsCount: number;
  activeBrandsCount: number;
  activeCorporaCount: number;
  themesCount: number;
  createdAt: Date;
};

export async function listTeamMembers(): Promise<TeamMember[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      primaryRole: users.primaryRole,
      userType: users.userType,
      status: users.status,
      organizationId: users.organizationId,
      organizationName: organizations.displayName,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.organizationId))
    .orderBy(desc(users.createdAt));
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const inviter = alias(users, "inviter");
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      primaryRole: invitations.primaryRole,
      organizationId: invitations.organizationId,
      organizationName: organizations.displayName,
      invitedByName: inviter.fullName,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt
    })
    .from(invitations)
    .leftJoin(organizations, eq(organizations.id, invitations.organizationId))
    .leftJoin(inviter, eq(inviter.id, invitations.invitedByUserId))
    .where(eq(invitations.status, "pending"))
    .orderBy(desc(invitations.createdAt));
}

export async function listOrganizationsForPicker() {
  return db
    .select({
      id: organizations.id,
      name: organizations.displayName,
      legalName: organizations.legalName
    })
    .from(organizations)
    .orderBy(asc(organizations.legalName));
}

export async function listOrganizationsForAdmin(): Promise<OrganizationAdminRow[]> {
  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      legalName: organizations.legalName,
      displayName: organizations.displayName,
      hqCountry: organizations.hqCountry,
      industryPrimary: organizations.industryPrimary,
      status: organizations.status,
      usersCount: sql<number>`count(distinct ${users.id})::int`,
      pendingInvitationsCount: sql<number>`count(distinct ${invitations.id}) filter (where ${invitations.status} = 'pending')::int`,
      brandsCount: sql<number>`count(distinct ${brands.id})::int`,
      activeBrandsCount: sql<number>`count(distinct ${brands.id}) filter (where ${brands.status} <> 'archived')::int`,
      activeCorporaCount: sql<number>`count(distinct ${studyCorpora.id}) filter (where ${studyCorpora.status} <> 'archived')::int`,
      themesCount: sql<number>`count(distinct ${themes.id})::int`,
      createdAt: organizations.createdAt
    })
    .from(organizations)
    .leftJoin(users, eq(users.organizationId, organizations.id))
    .leftJoin(invitations, eq(invitations.organizationId, organizations.id))
    .leftJoin(brands, eq(brands.organizationId, organizations.id))
    .leftJoin(studyCorpora, eq(studyCorpora.brandId, brands.id))
    .leftJoin(themes, eq(themes.organizationId, organizations.id))
    .groupBy(organizations.id)
    .orderBy(asc(organizations.legalName));

  return rows.map((row) => ({
    ...row,
    usersCount: Number(row.usersCount ?? 0),
    pendingInvitationsCount: Number(row.pendingInvitationsCount ?? 0),
    brandsCount: Number(row.brandsCount ?? 0),
    activeBrandsCount: Number(row.activeBrandsCount ?? 0),
    activeCorporaCount: Number(row.activeCorporaCount ?? 0),
    themesCount: Number(row.themesCount ?? 0)
  }));
}
