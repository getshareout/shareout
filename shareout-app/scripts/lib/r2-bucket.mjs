/**
 * Resolve the R2 bucket a skill maintenance script writes to.
 * No default on purpose: `--bucket=<name>` wins, then SKILL_R2_BUCKET, else throw.
 */
const R2_BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function resolveSkillBucket(argv = [], env = {}) {
  const flag = argv.find((arg) => arg.startsWith('--bucket='));
  const bucket = (flag ? flag.slice('--bucket='.length) : env.SKILL_R2_BUCKET || '').trim();
  if (!bucket) {
    throw new Error(
      'No R2 bucket given. Pass --bucket=<name> or set SKILL_R2_BUCKET (the bucket_name of your ARTIFACTS binding).',
    );
  }
  if (!R2_BUCKET_NAME.test(bucket)) {
    throw new Error(`Invalid R2 bucket name "${bucket}" (lowercase letters, digits and hyphens, 3-63 chars).`);
  }
  return bucket;
}
