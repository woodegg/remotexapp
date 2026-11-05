import { AudioCoordinator } from './audio-coordinator.js';
const coordinator = new AudioCoordinator();
self.onconnect = event => coordinator.add(event.ports[0]);
