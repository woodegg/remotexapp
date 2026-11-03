// A user-home template can only be opened through its registered managed target.
// Resolving a template never creates a registration or changes desired state.
export function templateTarget(template, managed = []) {
  if (!template?.id) throw new Error('template-unavailable');
  if (template.runMode !== 'user-home') return {templateId:template.id};
  const matches=managed.filter(item=>item.templateId===template.id);
  if (!matches.length) throw new Error('managed-registration-required');
  if (matches.length !== 1) throw new Error('managed-selection-required');
  const target=matches[0];
  if (target.desiredState !== 'running') throw new Error('managed-start-required');
  if (target.observedState !== 'running') throw new Error('managed-unavailable');
  return {managedId:target.id};
}

export function parameterValue(definition, value) {
  if (definition.type === 'boolean') return !!value;
  if (value === '') {
    if (definition.required) throw new Error('required-parameter');
    return undefined;
  }
  if (definition.type === 'integer') {
    const number=Number(value);
    if (!Number.isSafeInteger(number) || definition.minimum !== undefined && number < definition.minimum ||
        definition.maximum !== undefined && number > definition.maximum) throw new Error('invalid-integer');
    return number;
  }
  if (definition.type === 'json') return JSON.parse(value);
  if (definition.type === 'enum' && !definition.values?.includes(value)) throw new Error('invalid-enum');
  if (definition.maxLength && value.length > definition.maxLength) throw new Error('parameter-too-long');
  return value;
}

export function rateSnapshot(previous, current) {
  if (!previous?.available || !current?.available || previous.connectionEpoch !== current.connectionEpoch) return null;
  const seconds=(current.observedAt-previous.observedAt)/1000;
  if (!(seconds > 0 && seconds < 10)) return null;
  const difference=(key)=>Math.max(0,(current[key] || 0)-(previous[key] || 0))/seconds;
  return {download:(difference('receivedBytes')+difference('udpReceivedBytes'))*8/1000,
    upload:difference('sentBytes')*8/1000,fps:difference('renderedFrames')};
}

export function latencyText(sample) {
  return sample?.state === 'ready' ? `${sample.rttMs.toFixed(0)} ms` :
    ({pending:'测量中',waiting:'等待样本',inactive:'未启用',timeout:'超时',stale:'已过期'})[sample?.state] || '不可用';
}
