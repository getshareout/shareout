import type { DataContext } from '../middleware';
import { verifyOwner } from '../middleware';
import { extractTokenFromCookie, verifySessionToken } from '../../token';
import type { DbSlide } from './db';

export async function getSession(
  request: Request,
  ctx: DataContext
): Promise<{ userId: string; email: string; name?: string } | null> {
  const cookies = request.headers.get('Cookie');
  const token = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
  if (!token) return null;

  const payload = await verifySessionToken(token, ctx.env);
  if (!payload) return null;

  return {
    userId: payload.userId,
    email: payload.email,
    name: payload.email,
  };
}

export async function canEditPresentation(request: Request, ctx: DataContext, _presId: string): Promise<boolean> {
  const isOwner = await verifyOwner(request, ctx);
  if (isOwner) return true;

  const session = await getSession(request, ctx);
  if (!session) return false;

  const collaborator = await ctx.env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(ctx.artifactId, session.email).first<{ role: string }>();

  return collaborator?.role === 'owner' || collaborator?.role === 'editor';
}

export async function canEditSlide(request: Request, ctx: DataContext, presId: string, slide: DbSlide): Promise<boolean> {
  if (slide.locked) {
    const session = await getSession(request, ctx);
    const isSlideOwner = session && slide.owner_id === session.userId;
    const isPresOwner = await verifyOwner(request, ctx);

    if (!isSlideOwner && !isPresOwner) {
      return false;
    }
  }

  return canEditPresentation(request, ctx, presId);
}

