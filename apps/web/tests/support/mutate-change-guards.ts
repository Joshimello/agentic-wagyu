const mutants = [
  {
    file: 'apps/web/src/lib/server/contracts/changes.ts',
    from: '!verified || !value.completionCriteria || !evidence.length',
    to: 'false',
    test: 'completion verification requires',
  },
  {
    file: 'apps/web/src/lib/server/services/changes.ts',
    from: 'previous.id !== baseline?.id',
    to: 'false',
    test: 'simultaneous approvals have one effect',
  },
  {
    file: 'apps/web/src/lib/server/services/changes.ts',
    from: 'latest.get(admission.uploadId) !== revisionId',
    to: 'false',
    test: 'superseded baseline support rejects',
  },
];
async function run() {
  const child = Bun.spawn(
    ['bun', 'apps/web/tests/run.ts', 'integration', '--suite=changes'],
    { env: process.env, stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { output: out + err, status };
}
const baseline = await run();
if (baseline.status !== 0) {
  process.stderr.write(baseline.output);
  throw new Error('Baseline comparison tests must pass before mutation checks');
}
for (const mutant of mutants) {
  const original = await Bun.file(mutant.file).text();
  if (!original.includes(mutant.from))
    throw new Error(`Mutation guard not found: ${mutant.from}`);
  try {
    await Bun.write(mutant.file, original.replace(mutant.from, mutant.to));
    const result = await run();
    const expectedFailure = result.output
      .split('\n')
      .some((line) => line.includes('(fail)') && line.includes(mutant.test));
    if (result.status === 0 || !expectedFailure) {
      process.stderr.write(result.output);
      throw new Error(
        `Approval guard mutation survived or failed for another reason: ${mutant.from}`,
      );
    }
    console.log(`Mutation detected: ${mutant.test}`);
  } finally {
    await Bun.write(mutant.file, original);
  }
}
console.log(
  'All three approval guard mutations were detected; container sources restored.',
);
