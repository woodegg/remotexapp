const labels = {
  connecting:['连接中','Connecting'],ready:['已就绪','Ready'],
  recovering:['正在恢复','Recovering'],attention:['需要处理','Needs attention'],
  closed:['已关闭','Closed'],region:['连接恢复','Connection recovery'],
  retry:['重试连接','Retry connection'],refresh:['刷新状态','Refresh status'],
  recheck:['重新检查恢复','Recheck recovery'],reattach:['连接已恢复的应用','Reattach'],
  restart:['重启应用…','Restart App…'],authenticate:['重新登录','Sign in'],
  help:['诊断信息','Help'],cancel:['取消','Cancel'],confirm:['确认重启','Confirm restart'],
};

const explanations = {
  'runtime-invalidated':[
    '原会话已结束或发生变化。刷新状态后再选择操作。',
    'The original session ended or changed. Refresh its status before choosing an action.',
  ],
  'stale-generation':[
    '目标会话已变化。旧窗口不能继续操作它，请刷新状态。',
    'The target session changed. Refresh its status before using this window.',
  ],
  'operation-uncertain':[
    '请求结果不确定。请刷新状态确认；系统不会重复执行重启。',
    'The request outcome is uncertain. Refresh status to check it. The SDK will not repeat the restart.',
  ],
  'launch-uncertain':[
    '启动结果不确定。请检查已有应用；系统不会再次创建应用。',
    'The launch outcome is uncertain. Check your existing apps. The SDK will not create another app.',
  ],
  'operation-refused':[
    '服务端拒绝此次操作。请检查关闭阻塞或当前运行状态，不会自动强制关闭。',
    'The server refused this action. Check the shutdown blocker or current app status. The SDK will not force shutdown.',
  ],
  'recheck-submitted':[
    '已提交恢复重查；这不代表修复完成。稍后刷新状态查看结果。',
    'The recovery check was requested. Refresh status later to see the result.',
  ],
  'authentication-required':[
    '请通过宿主应用重新登录；旧登录会话不会自动取得新身份。',
    'Sign in again through the host app. The previous login cannot assume the new identity.',
  ],
  'permission-denied':[
    '当前身份没有权限。请联系管理员。',
    'Your current account lacks permission. Contact your administrator.',
  ],
  'target-changed':[
    '应用身份或组件已变化，需要由宿主应用或管理员确认目标。',
    'The app identity or component changed. Ask the host app or administrator to confirm the target.',
  ],
  'reconnect-exhausted':[
    '自动重连次数已用完。网络恢复后可以手动重试连接。',
    'Automatic connection retries are exhausted. Try again once the network is available.',
  ],
  'managed-unavailable':[
    '托管应用未运行或尚未就绪。请通过管理入口检查；连接操作不会启动或重启桌面。',
    'The managed app is stopped or unready. Check it in the management console. Connecting will not start or restart the desktop.',
  ],
};

const waiting = [
  '连接尚未就绪。以下操作由 SDK 和服务端共同检查。',
  'The connection is not ready. The SDK and server check the available actions.',
];
const recovering = [
  '正在尝试恢复连接；远程应用不会因此被重启。',
  'Trying to restore the connection. The remote app will stay running.',
];
const warning = [
  '重启会关闭该运行实例中的应用，并影响它的所有窗口和标签页。已保存文件保留，未保存内容可能丢失。请先保存工作；此操作不会自动强制关闭。',
  'Restarting closes this app and affects all its windows and tabs. Saved files remain. Unsaved work may be lost. Save your work first. This action does not force shutdown.',
];

export function recoveryPanelLocale(value) {
  if (typeof value !== 'string' || !value || value === 'bilingual') return 'bilingual';
  try {
    const {language, script, region} = new Intl.Locale(value);
    if (language === 'en') return 'en';
    if (language === 'zh' && (script === 'Hans' || !script && !['TW','HK','MO'].includes(region))) return 'zh-CN';
  } catch {
    // An invalid language tag uses the compatibility presentation.
  }
  return 'bilingual';
}

export function recoveryPanelCopy(locale) {
  const index = locale === 'en' ? 1 : 0;
  return {
    label(key) {
      const text = labels[key];
      return locale === 'bilingual' ? text.join(' · ') : text[index];
    },
    message(state, reason) {
      if (Object.hasOwn(explanations, reason)) return explanations[reason][index];
      return (state === 'recovering' ? recovering : waiting)[index];
    },
    warning: warning[index],
    recovery: (phase, reason) => index
      ? `Recovery status: ${phase} · ${reason || '—'}`
      : `恢复状态：${phase} · ${reason || '—'}`,
    diagnostic: reason => index
      ? `Diagnostic code: ${reason || 'unavailable'}. Use the administrator console to investigate system faults.`
      : `诊断代码：${reason || 'unavailable'}。复杂系统故障请通过管理员 Console 处理。`,
  };
}
