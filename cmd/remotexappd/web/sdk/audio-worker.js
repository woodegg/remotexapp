import { AudioCoordinator } from './audio-coordinator.js';
const coordinator = new AudioCoordinator();
// The native connection belongs to this document, not an individual Host.
// Never register bootstrap ports as audio peers or give them route authority.
self.onconnect = event => {
  const bootstrap = event.ports[0];
  bootstrap.onmessage = ({data}) => {
    if (data?.op === 'attach' && data.port instanceof MessagePort) coordinator.add(data.port);
  };
  bootstrap.start();
};
