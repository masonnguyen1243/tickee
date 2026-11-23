// Mô-đun `checkin`: API công khai cho mô-đun khác chỉ xuất từ file này (AD-10).
export { CheckinModule } from './checkin.module.js';
// Nhận lời mời CTV (Story 5.2): `flows.previewCheckerInvite`, `flows.acceptCheckerInvite`.
export {
  checkerInviteActive,
  checkerInviteByToken,
  checkerInviteInvalid,
  checkerRevoked,
  checkerStatusOf,
  joinChecker,
  type CheckerInviteRef,
} from './checkers.js';
