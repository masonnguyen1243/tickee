import { z } from 'zod';

/** Thông số OTP email dùng chung web và api (AD-19). */
export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_SECONDS = 60;

/** Email chuẩn hóa: bỏ khoảng trắng hai đầu, chữ thường. */
export const EmailAddress = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const OtpCode = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`));

/** `POST /v1/identity/otp` */
export const SendOtpRequest = z.object({ email: EmailAddress });
export type SendOtpRequest = z.input<typeof SendOtpRequest>;

export const SendOtpResponse = z.object({ resendAfterSeconds: z.number().int().positive() });
export type SendOtpResponse = z.infer<typeof SendOtpResponse>;

/** `POST /v1/identity/otp/verify` — thành công thì API set cookie session. */
export const VerifyOtpRequest = z.object({ email: EmailAddress, otp: OtpCode });
export type VerifyOtpRequest = z.input<typeof VerifyOtpRequest>;

export const VerifyOtpResponse = z.object({ consentRequired: z.boolean() });
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

/** `GET /v1/identity/me`, cũng là kết quả của `POST /v1/identity/consent`. */
export const Me = z.object({
  id: z.uuid(),
  email: z.email(),
  /** Thời điểm đồng ý NĐ 13 (ISO 8601); `null` = chưa đồng ý. */
  consentedAt: z.iso.datetime().nullable(),
});
export type Me = z.infer<typeof Me>;

/** `details` của lỗi `OTP_RATE_LIMITED`. */
export const OtpRateLimitedDetails = z.object({ retryAfterSeconds: z.number().int().positive() });
export type OtpRateLimitedDetails = z.infer<typeof OtpRateLimitedDetails>;

/** `details` của lỗi `OTP_INVALID`. */
export const OtpInvalidDetails = z.object({ remainingAttempts: z.number().int().min(1) });
export type OtpInvalidDetails = z.infer<typeof OtpInvalidDetails>;
