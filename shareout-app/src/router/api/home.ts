import { handleHomeBrowserApi, handleHomeQuickSearchApi, handleHomeCatalogApi, handleHomeCountsApi, handleHomeActivityApi, handleHomeCommentActivityApi, handleHomeAnalyticsApi, handleHomeActivityFeedApi, handleHomeForYouApi, handleHomeProfileGetApi, handleHomeProfileSetApi, handleHomeFollowApi, handleHomeRecentApi, handleHomeRecordViewApi, handleHomeDismissEventApi, handleHomeCommentsApi, handleHomeCommentPostApi } from '../../pages/home';
import { handleHomeEventVisibilityGetApi, handleHomeEventVisibilitySetApi } from '../../pages/home';
import { handleOnboardingGetApi, handleOnboardingDismissApi, handleOnboardingSkillAckApi, handleOnboardingCelebrateApi } from '../../onboarding/api';
import type { FetchContext } from '../context';
import { isAuthUser, requireAuthUser } from '../helpers/auth-guard';

export async function routeHomeApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/home/browser' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeBrowserApi(request, env, user));
  }

  if (path === '/v1/home/quick-search' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeQuickSearchApi(request, env, user));
  }

  if (path === '/v1/home/counts' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeCountsApi(request, env, user));
  }

  if (path === '/v1/home/catalog' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeCatalogApi(request, env, user));
  }

  if (path === '/v1/home/activity' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeActivityApi(request, env, user));
  }

  if (path === '/v1/home/comment-activity' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeCommentActivityApi(request, env, user));
  }

  if (path === '/v1/home/analytics' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeAnalyticsApi(request, env, user));
  }

  if (path === '/v1/home/activity-feed' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeActivityFeedApi(request, env, user));
  }

  if (path === '/v1/home/event-visibility' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeEventVisibilityGetApi(request, env, user));
  }

  if (path === '/v1/home/event-visibility' && request.method === 'PUT') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeEventVisibilitySetApi(request, env, user));
  }

  if (path === '/v1/home/for-you' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeForYouApi(request, env, user));
  }

  if (path === '/v1/home/recent' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeRecentApi(request, env, user));
  }

  if (path === '/v1/home/viewed' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeRecordViewApi(request, env, user));
  }

  if (path === '/v1/home/dismiss-event' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeDismissEventApi(request, env, user));
  }

  if (path === '/v1/home/onboarding' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleOnboardingGetApi(request, env, user));
  }

  if (path === '/v1/home/onboarding/dismiss' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleOnboardingDismissApi(request, env, user));
  }

  if (path === '/v1/home/onboarding/skill-ack' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleOnboardingSkillAckApi(request, env, user));
  }

  if (path === '/v1/home/onboarding/celebrate' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleOnboardingCelebrateApi(request, env, user));
  }

  if (path === '/v1/home/comments' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeCommentsApi(request, env, user));
  }

  if (path === '/v1/home/comments' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeCommentPostApi(request, env, user));
  }

  if (path === '/v1/home/profile' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeProfileGetApi(request, env, user));
  }

  if (path === '/v1/home/profile' && request.method === 'PUT') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeProfileSetApi(request, env, user));
  }

  if (path === '/v1/home/follow' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleHomeFollowApi(request, env, user));
  }

  return null;
}
