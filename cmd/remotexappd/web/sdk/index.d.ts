export const SDK_VERSION: '0.29.1';

export interface RemoteXAppClipboardSkipped { skipped:true; reason:'empty-clipboard'; }

export interface RemoteCursorEvent {
	type:'cursor-position'; sequence:number; updatedMs:number; focused:boolean; enabled:boolean;
	cursor?:{x:number;y:number;width:number;height:number}; error?:string;
	freshForPointer?:boolean; positionSource?:'remote-caret'|'awaiting-fresh-remote-caret'|'remote-caret-unavailable'|'click-fallback';
	clientPosition?:{left:number;top:number;height:number}|null; refocused?:boolean; latencyMs?:number|null;
}

export interface RemoteXApplicationStatus {
	generation:number; revision:number; state:'stopped'|'starting'|'loading'|'ready'|'error'|'exited';
	updatedAt:string; lastReadyAt?:string; summary?:string; details?:Record<string,unknown>; error?:string;
}

export interface RemoteXApplicationEnvironment {
	instanceId:string; sessionGeneration:number; applicationState:'ready';
	environment:Record<string,string>; workingDirectory:string;
}

export interface RemoteXAppParameterDefinition {
	type:'string'|'boolean'|'integer'|'enum'|'url'|'file'|'json'; required?:boolean; default?:unknown;
	values?:string[]; minimum?:number; maximum?:number; maxLength?:number; allowedSchemes?:string[];
	maxBytes?:number; maxDepth?:number; maxItems?:number;
}

export interface RemoteXAppLoopbackTCPResource {
	kind:'loopback-tcp'; address:'127.0.0.1'; port:number;
}

export interface RemoteXAppClass {
  id: string; name: string; driverVersion:string; singleton: boolean; profileRef: string;
	apiVersion?:'remotexapp/v1';
  runMode: 'shared' | 'isolated' | 'user-home';
  serverActivation: 'auto' | 'on-demand'; sessionActivation: 'on-attach' | 'immediate';
  vacantTimeout: string; vacantAction: 'keep' | 'stop-session' | 'stop-instance';
	gracefulShutdown:boolean;
  display: { mode:'fixed'|'dynamic'; number:number; size:string; depth:16|24; frameRate:number; allowClientResize:boolean };
  drivers?: { server:string; session:string; shutdown?:string };
  readiness: { serverPids:string[]; sessionPid:string; serverTimeout?:string; sessionTimeout?:string };
	input: { backend:string; lifecycle:'server'|'session'; allowedWmClasses:string[] };
	ports?:Record<string,{kind:'loopback-tcp';port:number}>;
	overrides?:{allowed:string[]};
	dependencies?:{executables:string[];pythonModules:string[]};
	parameters: Record<string,RemoteXAppParameterDefinition>;
	status:{mode:''|'driver';details:Record<string,RemoteXAppParameterDefinition>};
}

export interface RemoteXAppRuntimeVersion {
  core:{version:string;commit:string;sha256:string}|null;
  app:{id:string;version:string;sha256:string};
}
export interface RemoteXAppRuntimeVersions {
  current:RemoteXAppRuntimeVersion; available:RemoteXAppRuntimeVersion|null;
  targetRevision?:string; updateAvailable:boolean; eligible:boolean; reason?:string;
}
export interface RemoteXAppUpgradeStatus {
  id:string; phase:'stopping'|'launching'|'completed'|'blocked'|'failed';
  targetRevision:string; errorCode?:string; message?:string; updatedAt:string;
}
export interface RemoteXAppUpgradeOptions {
  sessionGeneration:number; targetRevision:string; force?:boolean; signal?:AbortSignal;
}
export interface RemoteXAppInstance {
  versions?:RemoteXAppRuntimeVersions; upgrade?:RemoteXAppUpgradeStatus;
	id:string; classId:string; templateId:string; driverVersion:string; managedInstanceId?:string; profileRef:string;
	workspaceMode:'ephemeral'|'persistent'; state:string; display:string;
	resources:Record<string,RemoteXAppLoopbackTCPResource>;
	effectivePolicy:{
	  display:{mode:'fixed'|'dynamic';number:number;size:string;depth:16|24;frameRate:number;allowClientResize:boolean};
	  runMode:'shared'|'isolated'|'user-home';
	  workspaceMode:'ephemeral'|'persistent';sessionActivation:'on-attach'|'immediate';
	  idleTimeout:string;idleAction:'keep'|'stop-session'|'stop-instance';singleton:boolean;
	};
	parameters?:Record<string,unknown>;
	applicationStatus?:RemoteXApplicationStatus; sessionGeneration:number;
  viewerUrl?:string; createdAt:string; error?:string; sessionState:string; attachedClients:number;
	shutdown?:{requestId:string;generation:number;reason:string;scope:'session'|'instance';state:string;requestedAt:string;blockedAt?:string;warningAt?:string;forceAt?:string;message?:string;forced:boolean};
  homePath?:string; xauthorityPath?:string; runtimePath?:string; socketRuntimePath?:string;
  internalRfbAddress?:string; internalGatewayAddress?:string;
  vncUnit?:string; gatewayUnit?:string; sessionUnit?:string;
}

export interface RemoteXAppOverrides {
	displayMode?:'fixed'|'dynamic'; display?:number; geometry?:string; frameRate?:number;
	allowClientResize?:boolean; workspaceMode?:'ephemeral'|'persistent';
	sessionActivation?:'on-attach'|'immediate'; idleTimeout?:string;
	idleAction?:'keep'|'stop-session'|'stop-instance'; singleton?:boolean;
}

export interface ManagedRemoteXApp {
  availableVersion?:RemoteXAppRuntimeVersion;
	id:string; templateId:string; desiredState:'running'|'stopped';
	appliedDriverVersion?:string; availableDriverVersion?:string; updateStatus:'current'|'update-available';
	observedState:string; profileRef:string; overrides?:RemoteXAppOverrides;
	parameters?:Record<string,unknown>;
	runtimeInstanceId?:string; runtime?:RemoteXAppInstance; createdAt:string; updatedAt:string; error?:string;
}

export interface RemoteXAppOperatorOperation {
	id:string; action:'restart-manager'; state:'accepted'|'running'|'succeeded'|'failed';
	requestedAt:string; startedAt?:string; finishedAt?:string; error?:string;
}

export type RemoteXAppClipboardMode = 'off'|'manual'|'prompt'|'auto';
export type RemoteXAppClipboardAccessState = 'granted'|'prompt'|'denied'|'unknown'|'unsupported'|'secure-context-required'|'requires-user-activation'|'document-not-focused'|'failed';
export interface RemoteXAppClipboardDirectionAccess {
	supported:boolean;permission:string;state:RemoteXAppClipboardAccessState;verified:boolean;reason?:string;
}
export interface RemoteXAppClipboardAccess {
	secureContext:boolean;focused:boolean|null;userActivation:boolean|null;
	read:RemoteXAppClipboardDirectionAccess;write:RemoteXAppClipboardDirectionAccess;
}
export interface RemoteXAppClipboardItem { type:'text/plain'|'text/html'|'text/rtf'|'image/png'; data:ArrayBuffer|ArrayBufferView|Blob|string; }
export interface RemoteXAppClipboardOffer {
	id:string;direction:'toRemote'|'toLocal';generation?:number;sequence?:number;sourceViewerId?:string;
	types:string[];totalBytes:number;state:string;createdAt:string;expiresAt?:string;recovered?:boolean;baseline?:boolean;
}
export interface RemoteXAppClipboardSnapshot {
	viewerId:string;config:{toRemote:RemoteXAppClipboardMode;toLocal:RemoteXAppClipboardMode;checkOnFocus:boolean};
	capabilities:Record<string,unknown>;permissions:{read:string;write:string};access:RemoteXAppClipboardAccess;pending:RemoteXAppClipboardOffer[];
	inputActive:boolean;
}

export class RemoteXAppAPIError extends Error { status:number; body:unknown; }
export interface RemoteXActions { instanceId:string; sessionGeneration:number; driverVersion:string; ready:boolean; actions:Record<string,{parameters:Record<string,unknown>;result:Record<string,unknown>;timeout:string}>; }
export interface RemoteXActionResult { instanceId:string;sessionGeneration:number;action:string;result:Record<string,unknown>; }

export interface RemoteXIdleLease {
  instanceId:string; sessionGeneration:number; outcome:'renewed'|'attached'|'kept';
  idleAction:'keep'|'stop-session'|'stop-instance'; idleTimeoutMs:number;
  serverTime:string; expiresAt:string|null;
}
/** Content-free lifecycle projection; not a full instance/control descriptor. */
export interface RemoteXRuntimeState {
  id:string;sessionGeneration:number;state:string;sessionState:string;attachedClients?:number;
  applicationStatus?:{state:string;generation:number};
}
export interface RemoteXRuntimeHandle extends EventTarget {
  readonly instanceId:string;readonly sessionGeneration:number|null;
  readonly manager:RemoteXAppManager;readonly state:'tracking'|'released'|'invalidated';
  readonly ready:Promise<RemoteXRuntimeHandle>;readonly instance:RemoteXRuntimeState|null;
  readonly lease:RemoteXIdleLease|null;readonly keepAlive:boolean;
  setKeepAlive(enabled:boolean):void;release():void;
  renewIdleLease(options?:{signal?:AbortSignal}):Promise<RemoteXIdleLease>;
}
export interface RemoteXCoordinatorDiagnostics {
  mode:'cross-tab'|'local';serverKey:string;scope:string;ownerId:string;destroyed:boolean;localHandles:number;
  policy:{heartbeatMs:number;leaderTimeoutMs:number;interestRetentionMs:number};
  peers:Array<{ownerId:string;ageMs:number;eligible:boolean;retained:boolean;interests:number}>;
  runtimes:Array<{instanceId:string;sessionGeneration:number|null;leaderId:string|null;isLeader:boolean;
    keepAlive:boolean;localHandles:number;remoteInterests:number;inFlight:boolean;
    instance:RemoteXRuntimeState|null;lease:RemoteXIdleLease|null;nextRenewalInMs:number|null}>;
  events:Array<{time:string;type:string;instanceId?:string;sessionGeneration?:number|null;
    previousLeaderId?:string|null;leaderId?:string|null;outcome?:string;status?:number;timedOut?:boolean}>;
}
export class RemoteXAppCoordinator extends EventTarget {
  constructor(options:{manager?:RemoteXAppManager;scope:string;crossTabs?:boolean});
  readonly manager:RemoteXAppManager;readonly mode:'cross-tab'|'local';readonly serverKey:string;
  track(instanceId:string,options?:{sessionGeneration?:number;keepAlive?:boolean}):RemoteXRuntimeHandle;
  /** Read-only, content-free local observation. Never acquires/renews interests. */
  getDiagnostics():RemoteXCoordinatorDiagnostics;
  destroy():void;
}

export class RemoteXAppManager extends EventTarget {
  getActions(instanceId:string,options?:{signal?:AbortSignal}):Promise<RemoteXActions>;
  invokeAction(instanceId:string,action:string,parameters:Record<string,unknown>,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<RemoteXActionResult>;
  constructor(options?:{baseURL?:string;fetchImpl?:typeof fetch});
  baseURL:string;
  url(path:string):string;
  request(path:string,options?:{method?:string;body?:unknown;signal?:AbortSignal;headers?:Record<string,string>}):Promise<any>;
	requestRaw(path:string,options?:{method?:string;body?:BodyInit;signal?:AbortSignal;headers?:Record<string,string>}):Promise<Response>;
	getVersion(options?:{signal?:AbortSignal}):Promise<{version:string;commit:string;buildDate:string;webFeatures:Record<string,boolean>;capabilities:Record<string,boolean>}>;
	getHealth(options?:{signal?:AbortSignal}):Promise<Record<string,unknown>>;
	listClasses(options?:{refresh?:boolean;signal?:AbortSignal}):Promise<RemoteXAppClass[]>;
	getClass(classId:string,options?:{refresh?:boolean;signal?:AbortSignal}):Promise<RemoteXAppClass|null>;
	listTemplates(options?:{refresh?:boolean;signal?:AbortSignal}):Promise<RemoteXAppClass[]>;
	getTemplate(templateId:string,options?:{refresh?:boolean;signal?:AbortSignal}):Promise<RemoteXAppClass|null>;
  listInstances(options?:{classId?:string;states?:string|string[];signal?:AbortSignal}):Promise<RemoteXAppInstance[]>;
  getInstance(instanceId:string,options?:{signal?:AbortSignal}):Promise<RemoteXAppInstance>;
  renewIdleLease(instanceId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<RemoteXIdleLease>;
  getConnections(instanceId:string,options?:{sessionGeneration?:number;signal?:AbortSignal}):Promise<RemoteXConnections>;
	getApplicationStatus(instanceId:string,options?:{signal?:AbortSignal}):Promise<RemoteXApplicationStatus>;
	getApplicationEnvironment(instanceId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<RemoteXApplicationEnvironment>;
	waitForApplicationState(instanceId:string,states:string|string[],options?:{generation?:number;timeout?:number;interval?:number;signal?:AbortSignal}):Promise<RemoteXApplicationStatus>;
	createInstance(options:{templateId?:string;classId?:string;profileRef?:string;parameters?:Record<string,unknown>;overrides?:RemoteXAppOverrides;signal?:AbortSignal}):Promise<RemoteXAppInstance>;
	launch(options:{templateId?:string;classId?:string;profileRef?:string;parameters?:Record<string,unknown>;overrides?:RemoteXAppOverrides;signal?:AbortSignal}):Promise<RemoteXAppInstance>;
  attachInstance(instanceId:string,options?:{signal?:AbortSignal}):Promise<{viewerUrl:string}>;
	stopInstance(instanceId:string,options?:{force?:boolean;signal?:AbortSignal}):Promise<RemoteXAppInstance>;
	restartInstance(instanceId:string,options:{sessionGeneration:number;force?:boolean;signal?:AbortSignal}):Promise<RemoteXAppInstance>;
  getRuntimeVersions(instanceId:string,options?:{signal?:AbortSignal}):Promise<{versions:RemoteXAppRuntimeVersions;upgrade:RemoteXAppUpgradeStatus|null}>;
  upgradeAndRestartInstance(instanceId:string,options:RemoteXAppUpgradeOptions):Promise<RemoteXAppInstance>;
	restartManagerService(options?:{signal?:AbortSignal}):Promise<RemoteXAppOperatorOperation>;
	getClipboardCapabilities(instanceId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<Record<string,unknown>>;
	listClipboardOffers(instanceId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<RemoteXAppClipboardOffer[]>;
	getClipboardOffer(instanceId:string,offerId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<RemoteXAppClipboardOffer>;
	sendClipboardOffer(instanceId:string,options:{sessionGeneration:number;viewerId:string;action?:'set'|'paste';items:Iterable<RemoteXAppClipboardItem>|Map<string,unknown>;expectedSequence?:number;signal?:AbortSignal}):Promise<RemoteXAppClipboardOffer|RemoteXAppClipboardSkipped>;
	acceptClipboardOffer(instanceId:string,offerId:string,options:{sessionGeneration:number;signal?:AbortSignal}):Promise<{offerId:string;items:RemoteXAppClipboardItem[]}>;
	cancelClipboardOffer(instanceId:string,offerId:string,options:{sessionGeneration:number;viewerId:string;signal?:AbortSignal}):Promise<{state:string}>;
	getOperatorOperation(operationId:string,options?:{signal?:AbortSignal}):Promise<RemoteXAppOperatorOperation>;
	waitForOperatorOperation(operationId:string,options?:{timeout?:number;interval?:number;signal?:AbortSignal}):Promise<RemoteXAppOperatorOperation>;
	listManagedInstances(options?:{signal?:AbortSignal}):Promise<ManagedRemoteXApp[]>;
	getManagedInstance(id:string,options?:{signal?:AbortSignal}):Promise<ManagedRemoteXApp>;
	createManagedInstance(options:{id:string;templateId:string;desiredState?:'running'|'stopped';profileRef?:string;parameters?:Record<string,unknown>;overrides?:RemoteXAppOverrides;signal?:AbortSignal}):Promise<ManagedRemoteXApp>;
	setManagedInstanceState(id:string,desiredState:'running'|'stopped',options?:{force?:boolean;signal?:AbortSignal}):Promise<ManagedRemoteXApp>;
	deleteManagedInstance(id:string,options?:{purge?:boolean;signal?:AbortSignal}):Promise<null>;
  viewerURL(instance:RemoteXAppInstance|string):string;
  waitForState(instanceId:string,states:string|string[],options?:{timeout?:number;interval?:number;signal?:AbortSignal}):Promise<RemoteXAppInstance>;
  watchInstance(instanceId:string,options?:{interval?:number;signal?:AbortSignal;onChange?:(instance:RemoteXAppInstance)=>void}):()=>void;
}

export interface RemoteXAppDiagnostics {
  state:string; reason?:string; rfbState:string; inputState:string; reconnectAttempt:number; maxReconnectAttempts:number; reconnectExhausted:boolean;
  instance:RemoteXAppInstance|null; class:RemoteXAppClass|null; cursor:RemoteCursorEvent|null; text:unknown;
  framebuffer:{width:number;height:number;cssWidth:number;cssHeight:number}|null;
  viewport:{width:number;height:number;devicePixelRatio:number}|null;
  traffic:Record<string,unknown>|null; events:Array<{at:string;line:string}>; inputEventTracing:boolean; diagnosticsEnabled:boolean; textBatchDelay:number;
  resizeDebounce:number;resizeMaxWait:number;
}

/** Ephemeral successful-transfer description; preview contains at most 80 code points plus ellipsis. Do not log clipboard previews. */
export interface RemoteXAppClipboardSummary {
  types:string[]; preview:string; totalBytes:number;
  representations:Array<{type:string;bytes:number;width?:number;height?:number}>;
}

export class RemoteXAppClipboard extends EventTarget {
	readonly viewerId:string;
	configure(options?:{toRemote?:RemoteXAppClipboardMode;toLocal?:RemoteXAppClipboardMode;checkOnFocus?:boolean}):RemoteXAppClipboardSnapshot;
	snapshot():RemoteXAppClipboardSnapshot;checkAccess():Promise<RemoteXAppClipboardSnapshot>;requestReadAccess():Promise<RemoteXAppClipboardSnapshot>;refreshCapabilities():Promise<RemoteXAppClipboardSnapshot>;
	list():Promise<RemoteXAppClipboardOffer[]>;send(items:Iterable<RemoteXAppClipboardItem>|Map<string,unknown>,options?:{action?:'set'|'paste';expectedSequence?:number}):Promise<RemoteXAppClipboardOffer|RemoteXAppClipboardSkipped>;
	syncToRemote(options?:{action?:'set'|'paste';items?:Iterable<RemoteXAppClipboardItem>|Map<string,unknown>}):Promise<RemoteXAppClipboardOffer|RemoteXAppClipboardSkipped>;
	syncToLocal(offerId:string):Promise<{offer:RemoteXAppClipboardOffer;types:string[];summary:RemoteXAppClipboardSummary}|RemoteXAppClipboardSkipped>;
	approve(offerId:string,options?:{action?:'set'|'paste'}):Promise<unknown>;cancel(offerId:string):Promise<{state:string}>;dismiss(offerId:string):boolean;destroy():void;
}

export class RemoteXAppClipboardPrompts {
	constructor(client:RemoteXAppClient,options?:{container?:Element;limit?:number;successDuration?:number});
	add(offer:RemoteXAppClipboardOffer):void;remove(id:string):void;destroy():void;
}

export class RemoteXAppClient extends EventTarget {
  invokeAction(action:string,parameters:Record<string,unknown>,options?:{signal?:AbortSignal}):Promise<RemoteXActionResult>;
  constructor(options:{runtime?:RemoteXRuntimeHandle;manager?:RemoteXAppManager;container:Element|string;instance?:RemoteXAppInstance;instanceId?:string;resize?:'class'|'remote'|'scale';resizeDebounce?:number;resizeMaxWait?:number;viewOnly?:boolean;connectionMask?:boolean;autoReconnect?:boolean;reconnectDelays?:number[];maxReconnectAttempts?:number;qualityLevel?:number;compressionLevel?:number;inputEventTracing?:boolean;diagnosticsEnabled?:boolean;diagnosticsInterval?:number;instancePollInterval?:number;cursorPollInterval?:number;textBatchDelay?:number});
  renewIdleLease(options?:{signal?:AbortSignal}):Promise<RemoteXIdleLease>;
  startIdleLease():Promise<RemoteXRuntimeHandle>;stopIdleLease():void;
  setConnectionMaskEnabled(enabled:boolean):void;
  state:string; instance:RemoteXAppInstance|null; instanceId:string; classInfo:RemoteXAppClass|null;
	clipboard:RemoteXAppClipboard;
  connect(instance?:RemoteXAppInstance|string):Promise<this>;
  launch(options:{templateId?:string;classId?:string;profileRef?:string;parameters?:Record<string,unknown>;overrides?:RemoteXAppOverrides}):Promise<this>;
  relaunch(options?:{templateId?:string;classId?:string;profileRef?:string;parameters?:Record<string,unknown>;overrides?:RemoteXAppOverrides}):Promise<this>;
  reconnect():Promise<this>; disconnect():void; destroy():void; focus():void; blur():void;
  flushResize():boolean;
  setViewOnly(value:boolean):Promise<this>; sendKey(keysym:number,code?:string,down?:boolean):boolean;
  sendText(value:string):Promise<{id:number;value:string;serverMs:number;roundTripMs:number;error:string}>;
  upgradeAndRestart(options:Omit<RemoteXAppUpgradeOptions,'sessionGeneration'> & {sessionGeneration?:number}):Promise<RemoteXAppInstance>;
  stopInstance():Promise<RemoteXAppInstance|null>; getDiagnostics():RemoteXAppDiagnostics;
  setDiagnosticsEnabled(value:boolean):Promise<RemoteXAppDiagnostics>; refreshDiagnostics():Promise<RemoteXAppDiagnostics>;
}

export class RemoteXAppElement extends HTMLElement {
  manager:RemoteXAppManager|null; client:RemoteXAppClient|null; instance:RemoteXAppInstance|null;
  connect():Promise<RemoteXAppClient>; reconnect():Promise<RemoteXAppClient>|undefined;
  disconnect():void; focus():void; getDiagnostics():RemoteXAppDiagnostics|null;
  flushResize():boolean|undefined;
  setDiagnosticsEnabled(value:boolean):Promise<RemoteXAppDiagnostics>|undefined;
  refreshDiagnostics():Promise<RemoteXAppDiagnostics>|undefined;
  stopInstance():Promise<RemoteXAppInstance|null>|undefined;
  upgradeAndRestart(options:Omit<RemoteXAppUpgradeOptions,'sessionGeneration'> & {sessionGeneration?:number}):Promise<RemoteXAppInstance>|undefined;
}

export function registerRemoteXAppElement(name?:string):CustomElementConstructor;

declare global { interface HTMLElementTagNameMap { 'remote-x-app':RemoteXAppElement } }
/** Protected host-local metadata; not a browser-reachable endpoint or control lease. */
export interface RemoteXConnections {
  schemaVersion:1;
  instanceId:string;
  sessionGeneration:number;
  revision:string;
  state:'ready';
  environment:{
    display:string;
    xauthorityPath:string;
    sessionBus?:{address:string;scope:'runtime'|'user'};
    ibus?:{address:string;scope:'runtime'};
  };
  application?:{protocol:string;[key:string]:unknown};
  unavailable?:string[];
  unavailableReasons?:{ibus?:'metadata-missing'|'not-enabled'|'not-running'};
}
