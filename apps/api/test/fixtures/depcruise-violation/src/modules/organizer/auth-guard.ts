// Cố ý vi phạm: mô-đun khác identity không import adapter NestJS của Better Auth.
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

export const open = AllowAnonymous;
