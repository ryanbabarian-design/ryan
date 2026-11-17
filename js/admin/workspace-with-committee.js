/** Extend the existing workspace using its existing store/auth client. */
import {createAdminWorkspace as original} from './workspace-ui.js?v=2.9.8-original';
import {installCommitteeUI} from '../review/committee-ui.js?v=2.9.13';
export * from './workspace-ui.js?v=2.9.8-original';
export function createAdminWorkspace(options){
  installCommitteeUI(options);
  return original(options);
}
