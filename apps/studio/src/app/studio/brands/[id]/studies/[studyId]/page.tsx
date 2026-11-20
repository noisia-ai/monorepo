import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireStudioUser} from '@/lib/auth/guards';
import {getBrandDetailForUser} from '@/lib/data/brands';
import {getAdminBrandWorkspace} from '@/lib/data/admin-workspace';
import {StudioStudyDetail} from '@/components/brands/StudioStudy';
export const dynamic='force-dynamic';
export default async function StudyPage({params}:{params:Promise<{id:string;studyId:string}>}){
 const {id,studyId}=await params,[session,t]=await Promise.all([requireStudioUser(`/studio/brands/${id}/studies/${studyId}`),getTranslations('StudioStudy')]);
 const [brand,workspace]=await Promise.all([getBrandDetailForUser(session.appUser,id),getAdminBrandWorkspace(session.appUser,id)]);
 if(!brand||!workspace?.summary.workspaceId)notFound();
 return <div className="admin-workspace-page"><header className="admin-section"><h1>{t('title')}</h1><nav>
  <Link href={`/studio/brands/${id}/studies`} prefetch={false}>{t('back')}</Link> · <Link href={`/studio/brands/${id}/brand-os`} prefetch={false}>{t('brandOs')}</Link> · <Link href={`/signal/${workspace.summary.workspaceSlug}`} prefetch={false}>{t('signal')}</Link>
 </nav></header><StudioStudyDetail key={`${workspace.summary.workspaceId}:${studyId}`} workspaceId={workspace.summary.workspaceId} studyId={studyId}/></div>;
}
