export function recoverySummary(runtime) {
  const recovery = runtime?.recovery;
  if (!recovery) return '';
  return `Recovery: ${recovery.phase} · ${recovery.message} · attempts ${recovery.attempts}${recovery.nextAttemptAt ? ` · next ${new Date(recovery.nextAttemptAt).toLocaleString()}` : ''}${recovery.lastSuccessAt ? ` · last healthy ${new Date(recovery.lastSuccessAt).toLocaleString()}` : ''}`;
}
