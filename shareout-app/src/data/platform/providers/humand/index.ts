import type { ProviderResponse, VerifyResult } from '../base-provider';
import type { ProviderEndpoint, ExecutionContext, RequestParams, DecryptedCredentials, PageInfo, RateLimitInfo, Env } from '../../types';
import { StaticCredentialsProvider } from '../static-credentials-provider';
import { registerProvider } from '../../registry';
import { createLogger, logError } from '../../../../logging';
import { userFacingProviderUpstreamError, userFacingVerifyUpstreamError } from '../../errors';
import { HUMAND_API, HUMAND_CONFIG } from './config';

// Read-only by construction: only GET endpoints are listed, and executeRequest
// refuses anything else. Humand's write endpoints (create/deactivate users, posts,
// documents, API-key rotate/revoke) are deliberately absent, and so are chats
// (private messages) and the API-key admin endpoints.
const PAGE = { type: 'page', defaultLimit: 10, maxLimit: 500 } as const;

const ENDPOINTS: Array<[id: string, path: string, description: string, ttlSeconds: number, paginated?: boolean]> = [
	['users.me', '/users/me', 'The API key\'s own user', 3600],
	['users.list', '/users', 'List users (search, page, limit)', 300, true],
	['users.get', '/users/{employeeInternalId}', 'Get a user by employee internal ID', 300],
	['users.profilePictures', '/users/profile-pictures', 'List profile pictures', 3600, true],
	['profileFields.list', '/profile-fields', 'List profile fields', 3600],
	['segmentations.list', '/segmentations', 'List segmentation groups and items', 600],
	['segmentations.users', '/segmentations/users', 'Users of segmentation items', 300, true],
	['departments.list', '/departments', 'List departments', 600, true],
	['departments.get', '/departments/{id}', 'Get a department', 600],
	['departments.members', '/departments/{id}/members', 'Members of a department', 300, true],
	['jobPositions.list', '/job-positions', 'List job positions', 600, true],
	['jobPositions.get', '/job-positions/{id}', 'Get a job position', 600],
	['jobPositions.members', '/job-positions/{id}/members', 'Members of a job position', 300, true],
	['timeOff.balances', '/time-off/balances', 'Time off balances', 300, true],
	['timeOff.balancesByCycle', '/time-off/balances/by-cycle', 'Time off balances by cycle', 300, true],
	['timeOff.requests', '/time-off/requests', 'Time off requests (states, fromDate, toDate, employeeInternalId…)', 300, true],
	['timeTracking.daySummaries', '/time-tracking/day-summaries', 'Time tracking day summaries', 300, true],
	['timeTracking.entries', '/time-tracking/entries', 'Clock-in/out entries (employeeId, startDate, endDate)', 300, true],
	['workSchedules.list', '/work-schedules', 'List work schedules', 600, true],
	['shifts.calendar', '/shifts/calendar', 'Shift calendar', 300],
	['shifts.planning', '/shifts/planning', 'Shift planning calendar', 300],
	['shifts.templates', '/shifts/templates', 'Shift templates', 600],
	['courses.list', '/courses', 'List courses', 600, true],
	['courses.get', '/courses/{courseId}', 'Get a course', 600],
	['courses.usersProgress', '/courses/{courseId}/users-progress', 'Course progress per user', 300, true],
	['learningPaths.usersProgress', '/learning-paths/{learningPathId}/users-progress', 'Learning path progress per user', 300, true],
	['forms.answers', '/forms/{id}/answers', 'Answers of a form or survey', 300, true],
	['acknowledgements.list', '/acknowledgements', 'List acknowledgements (recognitions)', 300, true],
	['knowledgeLibraries.list', '/knowledge-libraries', 'List root knowledge libraries', 600, true],
	['knowledgeLibraries.get', '/knowledge-libraries/{id}', 'Get a knowledge library', 600],
	['knowledgeLibraries.tree', '/knowledge-libraries/{id}/tree', 'Knowledge library descendant tree', 600],
	['goals.list', '/goals', 'Goals of a cycle', 300, true],
	['goalFormulas.list', '/goal-formulas', 'List goal formulas', 3600, true],
	['goalFormulas.rangeFields', '/goal-formulas/{id}/range-fields', 'Range fields a goal formula requires', 3600],
	['competencies.list', '/competencies', 'List competencies', 3600, true],
	['serviceItems.list', '/service-management/service-items', 'List service management items', 300, true],
	['serviceItems.get', '/service-management/service-items/{sid}', 'Get a service item', 300],
	['serviceItems.tasks', '/service-management/service-items/{sid}/tasks', 'Tasks of a service item', 300, true],
	['serviceTasks.get', '/service-management/tasks/{taskId}', 'Get a service task', 300],
	['serviceTasks.approvalGroups', '/service-management/tasks/{taskId}/approval-groups', 'Approval groups of a task', 300],
	['serviceTasks.approvalGroup', '/service-management/tasks/{taskId}/approval-groups/{approvalGroupId}', 'One approval group of a task', 300],
	['serviceStates.list', '/service-management/states', 'List task states', 3600],
	['exchanges.list', '/exchanges', 'List marketplace exchanges', 300, true],
];

/** Accept the key as pasted, with or without the `Basic ` prefix Humand's docs show. */
export function humandAuthHeader(apiKey: string): string {
	return `Basic ${apiKey.trim().replace(/^basic\s+/i, '')}`;
}

/**
 * Every `{param}` in the path must be supplied, and none may be a dot segment:
 * `..` would resolve the URL to a parent path the endpoint list doesn't allow.
 */
export function humandPathParamError(path: string, pathParams: RequestParams['pathParams'] = {}): string | null {
	for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
		const value = String(pathParams[name] ?? '').trim();
		if (!value) return `Missing path parameter: ${name}`;
		if (/^\.+$/.test(value)) return `Invalid path parameter: ${name}`;
	}
	return null;
}

/**
 * Humand answers a bad query with `[{ "isDefined": "employeeId should not be null or undefined" }]`.
 * Those messages name the missing or invalid parameters, so they are safe and useful to
 * pass on; anything else in a 400 body is dropped.
 */
export async function humandValidationMessage(response: Response): Promise<string | null> {
	const body = (await response.json().catch(() => null)) as unknown;
	if (!Array.isArray(body)) return null;
	const messages = body
		.flatMap((item) => (item && typeof item === 'object' ? Object.values(item as Record<string, unknown>) : []))
		.filter((v): v is string => typeof v === 'string')
		.slice(0, 5);
	return messages.length ? `Humand rejected the request: ${messages.join('; ')}`.slice(0, 300) : null;
}

/** Humand's `RateLimit: limit=100, remaining=45, reset=30` header (reset in seconds). */
export function parseHumandRateLimit(header: string | null, now = Date.now()): RateLimitInfo | null {
	if (!header) return null;
	const num = (k: string) => {
		const m = header.match(new RegExp(`${k}=(\\d+)`));
		return m ? parseInt(m[1], 10) : undefined;
	};
	const limit = num('limit');
	const remaining = num('remaining');
	if (limit === undefined || remaining === undefined) return null;
	const reset = num('reset');
	return { limit, remaining, resetAt: reset === undefined ? undefined : now + reset * 1000 };
}

/** Next page from a paginated body: `{ page, totalPages, count }`, or `{ count }` plus the request's page/limit. */
export function humandNextPage(data: unknown, query: RequestParams['queryParams'] = {}): PageInfo | null {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	const body = data as Record<string, unknown>;
	const count = typeof body.count === 'number' ? body.count : undefined;
	if (typeof body.page === 'number' && typeof body.totalPages === 'number') {
		const hasMore = body.page < body.totalPages;
		return { hasMore, cursor: hasMore ? String(body.page + 1) : undefined, total: count };
	}
	if (count === undefined) return null;
	const page = Number(query.page) || 1;
	const limit = Number(query.limit) || PAGE.defaultLimit;
	const hasMore = page * limit < count;
	return { hasMore, cursor: hasMore ? String(page + 1) : undefined, total: count };
}

class HumandProvider extends StaticCredentialsProvider {
	readonly config = HUMAND_CONFIG;

	readonly endpoints = new Map<string, ProviderEndpoint>(
		ENDPOINTS.map(([id, path, description, ttlSeconds, paginated]) => [
			id,
			{ id, method: 'GET', path, description, cache: { ttlSeconds }, ...(paginated ? { pagination: { ...PAGE } } : {}) },
		]),
	);

	async verifyConnection(env: Env, _config: Record<string, unknown>, credentials: DecryptedCredentials): Promise<VerifyResult> {
		if (!credentials.access_token?.trim()) return { ok: false, message: 'API key is required' };
		const res = await fetch(`${HUMAND_API}/users/me`, {
			headers: { Authorization: humandAuthHeader(credentials.access_token), Accept: 'application/json' },
		});
		if (res.ok) return { ok: true, message: 'Connected to Humand (read-only)' };
		if (res.status === 401 || res.status === 403) return { ok: false, message: 'API key rejected by Humand' };
		if (res.status === 429) return { ok: false, message: 'Humand is rate limiting this key; try again in a minute' };
		logError(
			createLogger(env, { scope: 'platform', provider: 'humand', event: 'verify.upstream.failed', http_status: res.status }),
			'Humand verify: profile probe failed',
			new Error(`HTTP ${res.status}`),
		);
		return { ok: false, message: userFacingVerifyUpstreamError(res.status) };
	}

	async executeRequest<T = unknown>(ctx: ExecutionContext, endpoint: ProviderEndpoint, params: RequestParams): Promise<ProviderResponse<T>> {
		if (endpoint.method !== 'GET' || this.endpoints.get(endpoint.id)?.path !== endpoint.path) {
			return this.fail('HUMAND_READ_ONLY', 'The Humand connector is read-only', 405);
		}
		if (!ctx.credentials.access_token?.trim()) return this.fail('MISSING_API_KEY', 'Humand API key is missing', 401);
		const pathError = humandPathParamError(endpoint.path, params.pathParams);
		if (pathError) return this.fail('INVALID_PATH_PARAM', pathError, 400);

		// Some Humand lists 400 without page/limit; send its documented defaults.
		const queryParams = endpoint.pagination ? { page: 1, limit: PAGE.defaultLimit, ...params.queryParams } : params.queryParams;
		const url = this.buildUrl(`${HUMAND_API}/`, { ...endpoint, path: endpoint.path.slice(1) }, { ...params, queryParams });
		const response = await fetch(url, {
			method: 'GET',
			headers: { Authorization: humandAuthHeader(ctx.credentials.access_token), Accept: 'application/json' },
		});
		const rateLimit = this.extractRateLimitInfo(response) ?? undefined;

		if (!response.ok) {
			logError(
				createLogger(ctx.env, { scope: 'platform', provider: 'humand', event: 'execute.upstream.failed', http_status: response.status }),
				'Humand execute: upstream request failed',
				new Error(`HTTP ${response.status}`),
			);
			const message = response.status === 401 || response.status === 403
				? 'API key rejected by Humand'
				: (response.status === 400 && (await humandValidationMessage(response))) || userFacingProviderUpstreamError(response.status);
			return { ...this.fail<T>(`HUMAND_${response.status}`, message, response.status), rateLimit };
		}

		const data = (await response.json()) as T;
		return {
			success: true,
			data,
			status: response.status,
			headers: response.headers,
			rateLimit,
			pagination: humandNextPage(data, queryParams) ?? undefined,
		};
	}

	extractRateLimitInfo(response: Response): RateLimitInfo | null {
		return parseHumandRateLimit(response.headers.get('RateLimit'));
	}
}

export const humandProvider = new HumandProvider();
registerProvider(humandProvider);

export { HUMAND_CONFIG } from './config';
