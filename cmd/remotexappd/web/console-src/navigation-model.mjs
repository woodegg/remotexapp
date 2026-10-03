const readyRuntimeStates = new Set(['server-ready', 'ready']);

export function runtimeVersionLabel(version) {
  if (!version) return 'unavailable';
  const core = version.core;
  return `Core ${core?.version || 'unknown'} (${core?.commit?.slice(0, 12) || 'unknown'}) · App ${version.app?.id || 'unknown'} ${version.app?.version || 'unknown'}`;
}

export function runtimeVersionSummary(runtime, available) {
  return `Current runtime version: ${runtime ? runtimeVersionLabel(runtime.versions?.current) : 'none'}\nAvailable version: ${runtimeVersionLabel(runtime?.versions?.available || available)}${runtime?.versions?.reason ? `\n${runtime.versions.reason}` : ''}${runtime?.upgrade ? `\nUpgrade: ${runtime.upgrade.phase}${runtime.upgrade.errorCode ? ` (${runtime.upgrade.errorCode})` : ''}` : ''}`;
}

export function standaloneRuntimes(runtimes = []) {
  return runtimes.filter(runtime => !runtime.managedInstanceId);
}

export function managedPrimaryAction(managed) {
  if (managed?.runtime && readyRuntimeStates.has(managed.runtime.state)) {
    return { kind:'connect', label:'Connect' };
  }
  if (managed?.desiredState === 'stopped' && !managed.runtime) {
    return { kind:'start-and-connect', label:'Start and connect' };
  }
  return { kind:'waiting', label:managed?.desiredState === 'running' ? 'Starting…' : 'Unavailable' };
}
