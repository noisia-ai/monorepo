import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireStudioUser} from '@/lib/auth/guards';
import {getBrandDetailForUser} from '@/lib/data/brands';
import {getAdminBrandWorkspace} from '@/lib/data/admin-workspace';
import {StudioStudyList} from '@/components/brands/StudioStudy';
export const dynamic='force-dynamic';
export default async function StudiesPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params,[session,t]=await Promise.all([requireStudioUser(`/studio/brands/${id}/studies`),getTranslations('StudioStudy')]);
 const [brand,workspace]=await Promise.all([getBrandDetailForUser(session.appUser,id),getAdminBrandWorkspace(session.appUser,id)]);
 if(!brand||!workspace?.summary.workspaceId)notFound();
 return <div className="admin-workspace-page"><header className="admin-section"><h1>{t('title')}</h1><nav>
  <Link href={`/studio/brands/${id}/brand-os`} prefetch={false}>{t('brandOs')}</Link> · <Link href={`/signal/${workspace.summary.workspaceSlug}`} prefetch={false}>{t('signal')}</Link>
 </nav></header><StudioStudyList key={workspace.summary.workspaceId} workspaceId={workspace.summary.workspaceId} brandId={id} brandName={brand.displayName??brand.name??''} timezone={workspace.summary.timezone??'UTC'}/></div>;
}
